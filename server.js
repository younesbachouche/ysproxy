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
    if (!url) return res.status(400).send('Missing url parameter');

    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Referer': req.headers['referer'] || '',
      'Origin': req.headers['origin'] || ''
    };

    console.log(`Proxy request for: ${url}`);

    const response = await fetch(url, { headers });
    if (!response.ok) return res.status(response.status).send('Failed to fetch resource');

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Text content (m3u8, mpd, text) rewrite URLs inside playlists
    if (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegURL') ||
      contentType.includes('application/dash+xml') ||
      contentType.includes('mpd+xml') ||
      contentType.startsWith('text/')
    ) {
      let body = await response.text();

      if (
        contentType.includes('application/vnd.apple.mpegurl') ||
        contentType.includes('vnd.apple.mpegurl') ||
        contentType.includes('application/x-mpegURL')
      ) {
        body = rewriteM3U8(body, url, req);
      }

      if (contentType.includes('application/dash+xml') || contentType.includes('mpd+xml')) {
        body = rewriteMPD(body, url, req);
      }

      return res.send(body);
    }

    // For binary content (segments, video, audio), pipe stream
    response.body.pipe(res);

  } catch (e) {
    console.error('Proxy error:', e);
    res.status(500).send('Server error');
  }
});

// Rewrite URLs inside m3u8 playlist
function rewriteM3U8(body, baseUrl, req) {
  const lines = body.split('\n').map(line => {
    if (line.trim() === '' || line.startsWith('#')) return line;
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

// Rewrite URLs inside MPD manifest XML
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
