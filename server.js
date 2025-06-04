const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing "url" query parameter');
  }

  // Add CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');

  const proxy = createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    secure: false,
    selfHandleResponse: false,
    headers: {
      'User-Agent': req.headers['user-agent'],
      'Referer': req.headers['referer'] || new URL(targetUrl).origin,
      'Origin': new URL(targetUrl).origin,
    },
    pathRewrite: () => '',
    router: () => targetUrl,
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader('User-Agent', req.headers['user-agent'] || '');
      proxyReq.setHeader('Referer', req.headers['referer'] || '');
    }
  });

  return proxy(req, res, next);
});

// Default 404 route
app.use((req, res) => {
  res.status(404).send('Use /proxy?url=...');
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`M3U8 proxy server running at http://localhost:${PORT}`);
});
