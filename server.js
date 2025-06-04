const express = require('express');
const axios = require('axios');
const { URL } = require('url');
const app = express();
const port = 3000;

// Middleware to parse query parameters
app.use(express.urlencoded({ extended: true }));

// Proxy endpoint
app.get('/proxy', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) {
            return res.status(400).send('Missing URL parameter');
        }

        // Get headers from the original request
        const userAgent = req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
        const referer = req.headers['referer'] || req.headers['referrer'] || targetUrl;

        // Prepare headers for the target request
        const headers = {
            'User-Agent': userAgent,
            'Referer': referer,
            'Accept': req.headers['accept'] || '*/*',
            'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        };

        // Make the request to the target URL
        const response = await axios.get(targetUrl, {
            headers,
            responseType: 'text',
            timeout: 10000
        });

        // Process M3U8 content if needed
        let content = response.data;
        const contentType = response.headers['content-type'] || 'application/vnd.apple.mpegurl';

        if (contentType.includes('mpegurl') || targetUrl.endsWith('.m3u8')) {
            content = processM3U8(content, targetUrl, req);
        }

        // Set response headers
        res.set('Content-Type', contentType);
        res.send(content);
    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(502).send(`Error fetching stream: ${error.message}`);
    }
});

// Process M3U8 playlist to rewrite URLs
function processM3U8(content, baseUrl, req) {
    const baseUrlObj = new URL(baseUrl);
    const lines = content.split('\n');
    const processedLines = [];

    for (let line of lines) {
        line = line.trim();
        if (line && !line.startsWith('#')) {
            try {
                // Handle relative URLs
                const segmentUrl = new URL(line, baseUrl);
                
                // Rewrite to go through our proxy
                const proxyUrl = new URL('/proxy', `${req.protocol}://${req.get('host')}`);
                proxyUrl.searchParams.set('url', segmentUrl.toString());
                
                line = proxyUrl.toString();
            } catch (e) {
                // If URL parsing fails, keep the original line
                console.warn(`Failed to process URL: ${line}`);
            }
        }
        processedLines.push(line);
    }

    return processedLines.join('\n');
}

// Homepage with usage instructions
app.get('/', (req, res) => {
    res.send(`
        <h1>M3U8 Proxy</h1>
        <p>This proxy automatically forwards your User-Agent and Referer headers.</p>
        <p>Usage:</p>
        <code>GET /proxy?url=YOUR_M3U8_URL</code>
        <p>Example:</p>
        <code>${req.protocol}://${req.get('host')}/proxy?url=https://example.com/stream.m3u8</code>
    `);
});

// Start the server
app.listen(port, () => {
    console.log(`M3U8 proxy server running on http://localhost:${port}`);
});
