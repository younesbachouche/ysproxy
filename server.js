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

    // Priority: query params override headers
    const userAgent = req.query.useragent || req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
    const referer = req.query.referer || req.headers['referer'] || 'https://allupplay.xyz/';

    const headers = {
      'User-Agent': userAgent,
      'Referer': referer,
    };

    console.log(`Proxying: ${url} with User-Agent: ${userAgent} and Referer: ${referer}`);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch resource, status: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    const isText = contentType.includes('application/vnd.apple.mpegurl') ||
                   contentType.includes('vnd.apple.mpegurl') ||
                   contentType.includes('application/x-mpegURL') ||
                   contentType.includes('application/dash+xml') ||
                   contentType.includes('mpd+xml') ||
                   contentType.startsWith('text/');

    if (isText) {
      let body = await response.text();

      if (
        contentType.includes('application/vnd.apple.mpegurl') ||
        contentType.includes('vnd.apple.mpegurl') ||
        contentType.includes('application/x-mpegURL')
      ) {
        body = rewriteM3U8(body, req);
        return res.send(body);
      }

      if (contentType.includes('application/dash+xml') || contentType.includes('mpd+xml')) {
        body = rewriteMPD(body, req);
        return res.send(body);
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
  return body.replace(/(https?:\/\/[^\s'"#]+|(?:\.{1,2}\/)[^\s'"#]+)/g, (match) => {
    try {
      const absoluteUrl = new URL(match, req.query.url).href;
      const encoded = encodeURIComponent(absoluteUrl);
      return `${req.protocol}://${req.get('host')}/proxy?url=${encoded}`;
    } catch {
      return match;
    }
  });
}

function rewriteMPD(body, req) {
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, url) => {
    try {
      const absoluteUrl = new URL(url, req.query.url).href;
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
