'use strict';

// Máy chủ chạy thử cục bộ (npm start) — trên Vercel sẽ tự dùng thư mục /api và /public
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const routes = {
  '/api/login': require('./api/login'),
  '/api/logout': require('./api/logout'),
  '/api/manifest': require('./api/manifest'),
  '/api/bundle': require('./api/bundle'),
  '/api/admin/state': require('./api/admin/state'),
  '/api/admin/publish': require('./api/admin/publish'),
  '/api/admin/upload': require('./api/admin/upload'),
  '/api/admin/rollback': require('./api/admin/rollback')
};

function enhanceResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (data) => {
    if (Buffer.isBuffer(data) || typeof data === 'string') {
      res.end(data);
    } else {
      res.json(data);
    }
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  enhanceResponse(res);
  const parsed = url.parse(req.url, true);
  req.query = parsed.query || {};

  const apiHandler = routes[parsed.pathname];
  if (apiHandler) {
    try {
      await apiHandler(req, res);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Internal Server Error' });
    }
    return;
  }

  let filePath = path.join(PUBLIC_DIR, parsed.pathname === '/' || parsed.pathname === '/admin' || parsed.pathname === '/login' ? 'index.html' : parsed.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.status(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.status(404).end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.status(200).end(content);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[VideoStarOTA] Local server running at http://localhost:${PORT}`);
  });
}

module.exports = { server, routes, enhanceResponse };
