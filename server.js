import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
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

    console.log(`\nProxying: ${url}`);
    console.log('Incoming Headers:', req.headers);

    const headers = {};
    if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
    if (req.headers['referer']) headers['Referer'] = req.headers['referer'];

    console.log('Forwarded Headers:', headers);

    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.log(`Fetch failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).send('Failed to fetch resource');
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
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
      response.body.pipe(res);
    }

  } catch (e) {
    console.error('Proxy error:', e);
    res.status(500).send('Server error');
  }
});

function rewriteM3U8(body, req) {
  const lines = body.split('\n').map(line => {
    if (line.trim() === '' || line.startsWith('#')) return line;
    try {
      const absoluteUrl = new URL(line, req.query.url).href;
      return `${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
    } catch {
      return line;
    }
  });
  return lines.join('\n');
}

function rewriteMPD(body, req) {
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, url) => {
    const absoluteUrl = new URL(url, req.query.url).href;
    return `<BaseURL>${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteUrl)}</BaseURL>`;
  });
}

app.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
