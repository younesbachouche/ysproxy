import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

// Forced headers (customize Referer/Origin as needed)
const FORCE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer': 'https://allupplay.xyz',
  'Origin': 'https://allupplay.xyz',
  'Accept': '*/*',
  'Connection': 'keep-alive',
};

// Allow CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Proxy endpoint
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url parameter');

  console.log(`🔁 Proxying: ${url}`);

  try {
    const headers = { ...FORCE_HEADERS };

    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.log(`❌ Fetch failed: ${response.status}`);
      return res.status(response.status).send('Failed to fetch resource');
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Handle playlists
    if (contentType.includes('mpegurl')) {
      const body = await response.text();
      const rewritten = rewriteM3U8(body, url, req);
      return res.send(rewritten);
    }

    if (contentType.includes('dash+xml') || contentType.includes('mpd+xml')) {
      const body = await response.text();
      const rewritten = rewriteMPD(body, url, req);
      return res.send(rewritten);
    }

    // Pipe binary segments
    response.body.pipe(res);
  } catch (err) {
    console.error('🚨 Proxy error:', err);
    res.status(500).send('Proxy error');
  }
});

function rewriteM3U8(body, baseUrl, req) {
  return body
    .split('\n')
    .map((line) => {
      if (line.trim() === '' || line.startsWith('#')) return line;
      try {
        const absolute = new URL(line, baseUrl).href;
        return `${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absolute)}`;
      } catch {
        return line;
      }
    })
    .join('\n');
}

function rewriteMPD(body, baseUrl, req) {
  return body.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, rawUrl) => {
    try {
      const absolute = new URL(rawUrl, baseUrl).href;
      return `<BaseURL>${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absolute)}</BaseURL>`;
    } catch {
      return `<BaseURL>${rawUrl}</BaseURL>`;
    }
  });
}

app.listen(port, () => {
  console.log(`🚀 Proxy server running on port ${port}`);
});
