import express from 'express';
import got from 'got';

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins and methods
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // Allow all origins
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Referer, User-Agent');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Helper: rewrite .m3u8 and .mpd manifest URLs to proxy through /watch
function rewriteManifest(manifestBody, proxyBaseUrl) {
  // Replace absolute URLs starting with http or https
  return manifestBody.replace(/(https?:\/\/[^\s"']+)/g, (url) => {
    // Encode URL and prepend proxy path
    return `${proxyBaseUrl}?url=${encodeURIComponent(url)}`;
  });
}

app.get('/watch', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  try {
    // Forward original User-Agent and Referer headers if present
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || '';

    // Fetch the upstream resource with forwarded headers
    const upstreamResponse = await got(targetUrl, {
      headers: {
        ...(userAgent && { 'User-Agent': userAgent }),
        ...(referer && { 'Referer': referer }),
      },
      responseType: 'buffer',
      timeout: 10000,
      retry: 1,
    });

    const contentType = upstreamResponse.headers['content-type'] || '';

    // Rewrite manifests to proxy URLs
    if (
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegURL') ||
      targetUrl.endsWith('.m3u8')
    ) {
      let body = upstreamResponse.body.toString('utf8');
      body = rewriteManifest(body, `${req.protocol}://${req.get('host')}/watch`);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(body);
    }

    if (
      contentType.includes('application/dash+xml') ||
      targetUrl.endsWith('.mpd')
    ) {
      let body = upstreamResponse.body.toString('utf8');
      body = rewriteManifest(body, `${req.protocol}://${req.get('host')}/watch`);
      res.setHeader('Content-Type', 'application/dash+xml');
      return res.send(body);
    }

    // For other content, just proxy as is
    res.setHeader('Content-Type', contentType);
    res.send(upstreamResponse.body);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).send('Proxy error: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Streaming proxy listening at http://localhost:${PORT}`);
});