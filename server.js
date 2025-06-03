import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

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
    if (!url) {
      console.log('Missing url param');
      return res.status(400).send('Missing url parameter');
    }
    console.log('Proxy request for:', url);

    // Forward user-agent and referer
    const headers = {};
    if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
    if (req.headers['referer']) headers['Referer'] = req.headers['referer'];

    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.log(`Failed to fetch: ${response.status} ${response.statusText}`);
      return res.status(response.status).send('Failed to fetch resource');
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    const isText = contentType.includes('mpegurl') ||
                   contentType.includes('dash+xml') ||
                   contentType.startsWith('text/');

    if (isText) {
      let body = await response.text();

      if (contentType.includes('mpegurl')) {
        body = rewriteM3U8(body, url, req);
      } else if (contentType.includes('dash+xml')) {
        body = rewriteMPD(body, url, req);
      }

      res.send(body);
    } else {
      console.log('Streaming binary content');
      response.body.pipe(res);
    }
  } catch (e) {
    console.error('Proxy error:', e);
    res.status(500).send('Server error');
  }
});

function rewriteM3U8(body, baseUrl, req) {
  return body.replace(/(https?:\/\/[^\s'"#]+|(?:\.{1,2}\/)[^\s'"#]+)/g, (match) => {
    try {
      const absUrl = new URL(match, baseUrl).href;
      const encoded = encodeURIComponent(absUrl);
      return `${req.protocol}://${req.get('host')}/proxy?url=${encoded}`;
    } catch {
      return match;
    }
  });
}

function rewriteMPD(body, baseUrl, req) {
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, url) => {
    try {
      const absUrl = new URL(url, baseUrl).href;
      const encoded = encodeURIComponent(absUrl);
      return `<BaseURL>${req.protocol}://${req.get('host')}/proxy?url=${encoded}</BaseURL>`;
    } catch {
      return `<BaseURL>${url}</BaseURL>`;
    }
  });
}

app.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
