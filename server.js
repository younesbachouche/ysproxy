app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url parameter');

    // Forward headers from client
    const headers = {};
    if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];
    if (req.headers['referer']) headers['Referer'] = req.headers['referer'];

    // Fetch original resource
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch resource');
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Check if text or binary
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
      // For binary data (media segments), pipe directly
      response.body.pipe(res);
    }
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});
