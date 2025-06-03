import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // CORS headers
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Referer, User-Agent');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Helper: get fetch (built-in in Node 18+)
const fetchFn = global.fetch || (await import('node-fetch')).default;

app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url parameter');

    // Forward headers from client
    const headers = {};
    if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
    if (req.headers['referer']) headers['Referer'] = req.headers['referer'];

    const response = await fetchFn(url, { headers });

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch resource: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    // For playlists/manifests, we need to rewrite URLs
    if (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegURL')
    ) {
      const body = await response.text();
      const rewritten = rewriteM3U8(body, url, req);
      return res.send(rewritten);
    }

    if (contentType.includes('application/dash+xml') || contentType.includes('mpd+xml')) {
      const body = await response.text();
      const rewritten = rewriteMPD(body, url, req);
      return res.send(rewritten);
    }

    // For other content (media segments, etc), pipe the binary data directly:
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).send('Server error');
  }
});

function rewriteM3U8(body, baseUrl, req) {
  // Rewrite URLs in the m3u8 playlist to go through proxy
  // Match URLs that are absolute or relative
  return body.replace(/(https?:\/\/[^\s'"#]+|(?:\.{1,2}\/)[^\s'"#]+)/g, (match) => {
    try {
      const absoluteUrl = new URL(match, baseUrl).href;
      const encoded = encodeURIComponent(absoluteUrl);
      return `${req.protocol}://${req.get('host')}/proxy?url=${encoded}`;
    } catch {
      return match;
    }
  });
}

function rewriteMPD(body, baseUrl, req) {
  // Rewrite <BaseURL> tags in MPD XML manifest to proxy URLs
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, url) => {
    try {
      const absoluteUrl = new URL(url, baseUrl).href;
      const encoded = encodeURIComponent(absoluteUrl);
      return `<BaseURL>${req.protocol}://${req.get('host')}/proxy?url=${encoded}</BaseURL>`;
    } catch {
      return `<BaseURL>${url}</BaseURL>`;
    }
  });
}

app.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
