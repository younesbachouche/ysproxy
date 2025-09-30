// proxy.js
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // npm i node-fetch@2

const app = express();
app.use(cors()); // allow browser to request the proxy

// Defaults you asked for:
const DEFAULT_REFERER = 'https://liveboxpro.com/';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

// Simple whitelist (only allow m3u8 from dupereasy.com). Change / extend as needed.
const ALLOWED_HOST_PATTERN = /dupereasy\.com/i;

app.get('/proxy', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url parameter');

    // validate URL and only allow .m3u8, and host pattern
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return res.status(400).send('Invalid URL');
    }

    if (!targetUrl.toLowerCase().endsWith('.m3u8')) {
      return res.status(400).send('Only .m3u8 files are allowed');
    }

    if (!ALLOWED_HOST_PATTERN.test(parsed.hostname)) {
      return res.status(403).send('Host not allowed by proxy');
    }

    // You can override via query params, but default to the values you provided
    const referer = req.query.referer || DEFAULT_REFERER;
    const userAgent = req.query.userAgent || DEFAULT_USER_AGENT;

    // Build headers for the outgoing request
    const forwardHeaders = {
      'referer': referer,
      'user-agent': userAgent,
      // optionally accept gzip
      'accept': '*/*',
    };

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: forwardHeaders,
      redirect: 'follow',
    });

    // forward status code
    res.status(response.status);

    // copy safe headers (content-type, cache-control, etc)
    const hopByHop = new Set([
      'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
      'te', 'trailer', 'transfer-encoding', 'upgrade'
    ]);

    response.headers.forEach((value, key) => {
      if (!hopByHop.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // stream body
    if (response.body) {
      response.body.pipe(res);
    } else {
      const text = await response.text();
      res.send(text);
    }

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Error fetching the URL');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`M3U8 proxy running on port ${PORT}`);
});
