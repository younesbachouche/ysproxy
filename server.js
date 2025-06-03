import express from 'express';
import fetch from 'node-fetch';

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

// Proxy endpoint: /proxy?url=ENCODED_URL
app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url parameter');

    // Forward headers from client
    const headers = {};
    if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
    if (req.headers['referer']) headers['Referer'] = req.headers['referer'];

    // Fetch original resource
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch resource');
    }

    // Get content-type
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    let body = await response.text();

    // If it's an m3u8 playlist, rewrite URLs inside it
    if (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegURL')
    ) {
      body = rewriteM3U8(body, req);
      return res.send(body);
    }

    // If it's an MPD (dash) manifest, rewrite URLs inside it
    if (contentType.includes('application/dash+xml') || contentType.includes('mpd+xml')) {
      body = rewriteMPD(body, req);
      return res.send(body);
    }

    // For other content, just pipe it
    res.send(body);

  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

function rewriteM3U8(body, req) {
  // Rewrite all non-comment lines (not starting with #) as proxied URLs
  const lines = body.split('\n').map(line => {
    if (line.trim() === '' || line.startsWith('#')) {
      return line; // leave comments and empty lines unchanged
    }
    try {
      const absoluteUrl = new URL(line, req.query.url).href;
      const encoded = encodeURIComponent(absoluteUrl);
      return `${req.protocol}://${req.get('host')}/proxy?url=${encoded}`;
    } catch {
      // If it's not a valid URL, leave as-is
      return line;
    }
  });
  return lines.join('\n');
}

function rewriteMPD(body, req) {
  // MPD is XML, rewrite URLs inside <BaseURL> tags
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, url) => {
    const encoded = encodeURIComponent(new URL(url, req.query.url).href);
    return `<BaseURL>${req.protocol}://${req.get('host')}/proxy?url=${encoded}</BaseURL>`;
  });
}

app.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
