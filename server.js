import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Referer, User-Agent');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url parameter');
    console.log(`Proxy request for: ${url}`);

    // Force working headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': 'https://allupplay.xyz',
      'Origin': 'https://allupplay.xyz',
      'Accept': '*/*',
      'Connection': 'keep-alive',
    };

    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.error(`Failed to fetch: ${response.status}`);
      return res.status(response.status).send('Failed to fetch resource');
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (contentType.includes('application/vnd.apple.mpegurl') ||
        contentType.includes('vnd.apple.mpegurl') ||
        contentType.includes('application/x-mpegURL') ||
        contentType.includes('application/dash+xml') ||
        contentType.includes('mpd+xml') ||
        contentType.startsWith('text/')) {

      let body = await response.text();

      if (contentType.includes('mpegurl')) {
        body = rewriteM3U8(body, req);
      } else if (contentType.includes('mpd+xml')) {
        body = rewriteMPD(body, req);
      }

      return res.send(body);
    } else {
      // Binary content (like TS segments)
      return response.body.pipe(res);
    }
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

function rewriteM3U8(body, req) {
  return body
    .split('\n')
    .map(line => {
      if (line.trim() === '' || line.startsWith('#')) return line;
      try {
        const absUrl = new URL(line, req.query.url).href;
        return `${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absUrl)}`;
      } catch {
        return line;
      }
    })
    .join('\n');
}

function rewriteMPD(body, req) {
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, url) => {
    const absUrl = new URL(url, req.query.url).href;
    const encoded = encodeURIComponent(absUrl);
    return `<BaseURL>${req.protocol}://${req.get('host')}/proxy?url=${encoded}</BaseURL>`;
  });
}

app.listen(port, () => {
  console.log(`Proxy server running on port ${port}`);
});
