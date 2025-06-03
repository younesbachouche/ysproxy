import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
  // Allow CORS for all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Referer, User-Agent');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url parameter');

    // Forward user-agent and referer headers from client to target
    const headers = {};
    if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
    if (req.headers['referer']) headers['Referer'] = req.headers['referer'];

    // Fetch resource from original server
    const response = await fetch(url, { headers });
    if (!response.ok) return res.status(response.status).send('Failed to fetch resource');

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Determine if response is text (manifests) or binary (segments)
    const isText = contentType.includes('application/vnd.apple.mpegurl') ||
                   contentType.includes('vnd.apple.mpegurl') ||
                   contentType.includes('application/x-mpegURL') ||
                   contentType.includes('application/dash+xml') ||
                   contentType.includes('mpd+xml') ||
                   contentType.startsWith('text/');

    if (isText) {
      let body = await response.text();

      if (contentType.includes('application/vnd.apple.mpegurl') ||
          contentType.includes('vnd.apple.mpegurl') ||
          contentType.includes('application/x-mpegURL')) {
        body = rewriteM3U8(body, url, req);
      } else if (contentType.includes('application/dash+xml') ||
                 contentType.includes('mpd+xml')) {
        body = rewriteMPD(body, url, req);
      }

      return res.send(body);
    } else {
      // Pipe binary data directly
      response.body.pipe(res);
    }

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Server error');
  }
});

function rewriteM3U8(body, baseUrl, req) {
  // Rewrite all URLs in the m3u8 playlist to route through the proxy
  return body.replace(/(https?:\/\/[^\s'"#]+|(?:\.{1,2}\/)[^\s'"#]+)/g, (match) => {
    try {
      const absoluteUrl = new URL(match, baseUrl).href;
      const encoded = encodeURIComponent(absoluteUrl);
      return `${req.protocol}://${req.get('host')}/proxy?url=${encoded}`;
    } catch {
      return match; // if URL constructor fails, return original
    }
  });
}

function rewriteMPD(body, baseUrl, req) {
  // Rewrite <BaseURL> tags inside MPD manifest
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
