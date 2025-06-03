import express from 'express';
import fetch from 'node-fetch';
import zlib from 'zlib';

const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // CORS headers
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Referer, User-Agent, Cookie');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url parameter');

    // Forward all client headers relevant for fetch
    const headersToForward = ['user-agent', 'referer', 'cookie', 'origin', 'accept-language', 'accept-encoding'];
    const headers = {};
    headersToForward.forEach(h => {
      if (req.headers[h]) headers[h] = req.headers[h];
    });

    console.log('Proxy request for:', url);
    // Fetch the resource with forwarded headers
    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.error('Fetch failed:', response.status, response.statusText);
      return res.status(response.status).send('Failed to fetch resource');
    }

    // Pass content-type and CORS headers downstream
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Get content encoding (gzip, deflate, etc) to handle decompression
    const contentEncoding = response.headers.get('content-encoding');

    // Handle playlists (m3u8 or MPD manifests)
    if (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegURL') ||
      contentType.includes('application/dash+xml') ||
      contentType.includes('mpd+xml') ||
      contentType.startsWith('text/')
    ) {
      let buffer = await response.buffer();

      // Decompress if needed
      if (contentEncoding === 'gzip') {
        buffer = zlib.gunzipSync(buffer);
      } else if (contentEncoding === 'deflate') {
        buffer = zlib.inflateSync(buffer);
      }

      let body = buffer.toString('utf8');

      if (
        contentType.includes('application/vnd.apple.mpegurl') ||
        contentType.includes('vnd.apple.mpegurl') ||
        contentType.includes('application/x-mpegURL')
      ) {
        body = rewriteM3U8(body, url, req);
      } else if (contentType.includes('application/dash+xml') || contentType.includes('mpd+xml')) {
        body = rewriteMPD(body, url, req);
      }

      return res.send(body);
    } else {
      // Stream binary media segments or other content directly
      if (contentEncoding) {
        // Remove encoding so client handles it correctly
        res.removeHeader('content-encoding');
      }
      response.body.pipe(res);
    }
  } catch (e) {
    console.error('Proxy error:', e);
    res.status(500).send('Server error');
  }
});

function rewriteM3U8(body, baseUrl, req) {
  const lines = body.split('\n').map(line => {
    if (line.trim() === '' || line.startsWith('#')) {
      return line; // comments and empty lines unchanged
    }
    try {
      const absoluteUrl = new URL(line, baseUrl).href;
      const encoded = encodeURIComponent(absoluteUrl);
      return `${req.protocol}://${req.get('host')}/proxy?url=${encoded}`;
    } catch {
      return line;
    }
  });
  return lines.join('\n');
}

function rewriteMPD(body, baseUrl, req) {
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, url) => {
    const absoluteUrl = new URL(url, baseUrl).href;
    const encoded = encodeURIComponent(absoluteUrl);
    return `<BaseURL>${req.protocol}://${req.get('host')}/proxy?url=${encoded}</BaseURL>`;
  });
}

app.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
