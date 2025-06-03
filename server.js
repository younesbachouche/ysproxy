import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Referer, User-Agent, Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const FORCE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer': 'https://allupplay.xyz',  // Change this to the referer your stream expects
  'Origin': 'https://allupplay.xyz',
  'Accept': '*/*',
  'Connection': 'keep-alive'
};

app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url parameter');

    console.log('Proxy request for:', url);

    // Always send forced headers, ignore client's headers to avoid missing headers
    const headers = { ...FORCE_HEADERS };

    const response = await fetch(url, { headers });
    if (!response.ok) return res.status(response.status).send('Failed to fetch resource');

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegURL')
    ) {
      let body = await response.text();
      body = rewriteM3U8(body, url, req);
      return res.send(body);
    }

    if (contentType.includes('application/dash+xml') || contentType.includes('mpd+xml')) {
      let body = await response.text();
      body = rewriteMPD(body, url, req);
      return res.send(body);
    }

    // For media segments or binary content, pipe the stream directly
    response.body.pipe(res);

  } catch (e) {
    console.error('Proxy error:', e);
    res.status(500).send('Server error');
  }
});

function rewriteM3U8(body, baseUrl, req) {
  return body.split('\n').map(line => {
    if (line.trim() === '' || line.startsWith('#')) return line;
    try {
      const absoluteUrl = new URL(line, baseUrl).href;
      const encodedUrl = encodeURIComponent(absoluteUrl);
      return `${req.protocol}://${req.get('host')}/proxy?url=${encodedUrl}`;
    } catch {
      return line;
    }
  }).join('\n');
}

function rewriteMPD(body, baseUrl, req) {
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, url) => {
    try {
      const absoluteUrl = new URL(url, baseUrl).href;
      const encodedUrl = encodeURIComponent(absoluteUrl);
      return `<BaseURL>${req.protocol}://${req.get('host')}/proxy?url=${encodedUrl}</BaseURL>`;
    } catch {
      return `<BaseURL>${url}</BaseURL>`;
    }
  });
}

app.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
