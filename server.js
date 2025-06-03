import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // CORS
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Referer, User-Agent, Origin, Cookie, Range');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Utility: Allowed proxy headers keys we accept from client query or forward from client req headers
const ALLOWED_HEADERS = [
  'user-agent', 'referer', 'origin', 'cookie', 'range', 'accept-language', 'accept-encoding'
];

app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url parameter');

    // Collect headers to forward
    const headers = {};

    // 1) Headers specified in query params: ?user-agent=xxx&referer=yyy etc
    ALLOWED_HEADERS.forEach((h) => {
      if (req.query[h]) {
        headers[h] = req.query[h];
      }
    });

    // 2) If not in query, forward from original client request headers if present
    ALLOWED_HEADERS.forEach((h) => {
      if (!headers[h] && req.headers[h]) {
        headers[h] = req.headers[h];
      }
    });

    // For node-fetch, headers keys should be case-insensitive strings
    // convert keys to proper casing:
    const fetchHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      // Capitalize header keys properly, e.g. user-agent -> User-Agent
      const properKey = k
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join('-');
      fetchHeaders[properKey] = v;
    }

    console.log(`Proxy request for: ${url}`);
    console.log('Forwarding headers:', fetchHeaders);

    const response = await fetch(url, { headers: fetchHeaders });

    if (!response.ok) {
      console.error(`Failed to fetch: ${response.status} ${response.statusText}`);
      return res.status(response.status).send(`Failed to fetch resource: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Determine if body is text (for manifest files) or binary (media segments)
    const isText = contentType.includes('application/vnd.apple.mpegurl') ||
                   contentType.includes('application/x-mpegURL') ||
                   contentType.includes('application/dash+xml') ||
                   contentType.includes('mpd+xml') ||
                   contentType.startsWith('text/');

    if (isText) {
      let body = await response.text();

      if (
        contentType.includes('application/vnd.apple.mpegurl') ||
        contentType.includes('application/x-mpegURL')
      ) {
        body = rewriteM3U8(body, url, req);
      } else if (
        contentType.includes('application/dash+xml') ||
        contentType.includes('mpd+xml')
      ) {
        body = rewriteMPD(body, url, req);
      }

      return res.send(body);
    } else {
      // Binary data (media segments), pipe directly
      response.body.pipe(res);
    }
  } catch (e) {
    console.error('Proxy error:', e);
    res.status(500).send('Server error');
  }
});

// Rewrite m3u8 playlist URLs to pass through proxy
function rewriteM3U8(body, baseUrl, req) {
  return body.replace(/(https?:\/\/[^\s'"#]+|(?:\.{1,2}\/)[^\s'"#]+)/g, (match) => {
    try {
      const absoluteUrl = new URL(match, baseUrl).href;
      const encoded = encodeURIComponent(absoluteUrl);
      return `${req.protocol}://${req.get('host')}/proxy?url=${encoded}`;
    } catch {
      return match; // if URL parsing fails, return original
    }
  });
}

// Rewrite MPD manifest <BaseURL> tags to proxy URLs
function rewriteMPD(body, baseUrl, req) {
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
