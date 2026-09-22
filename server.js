// Local dev + test server: serves the existing static site exactly as
// Vercel does, and dispatches /api/t08/* to the same handler modules that
// deploy as Vercel serverless functions. Vercel itself never runs this
// file — it only matters for `npm run dev` and the test suite.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

// Only the bootstrap/invite routes (their own, flag-gated/rarely-used
// functions) are listed individually here. Every other /api/t08/* route —
// auth/*, passkeys, passkeys/:id, passkeys/register/* — is handled by the
// single catch-all handler below, exactly as Vercel routes them: a static
// path listed here wins if present, otherwise it falls through to the
// catch-all. This mirrors the deployed function layout under api/t08/.
const routes = [
  ['POST', '/api/t08/bootstrap/register/options', 'api/t08/bootstrap/register/options.js'],
  ['POST', '/api/t08/bootstrap/register/verify', 'api/t08/bootstrap/register/verify.js'],
  ['POST', '/api/t08/invite/register/options', 'api/t08/invite/register/options.js'],
  ['POST', '/api/t08/invite/register/verify', 'api/t08/invite/register/verify.js'],
];

const T08_CATCH_ALL = 'api/t08/dispatch.js';

function findRoute(method, pathname) {
  for (const [routeMethod, routePath, file] of routes) {
    if (routeMethod === method && routePath === pathname) return file;
  }
  if (pathname.startsWith('/api/t08/')) return T08_CATCH_ALL;
  return null;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    const file = findRoute(req.method, pathname);
    if (!file) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    delete require.cache[require.resolve(path.join(ROOT, file))];
    const handler = require(path.join(ROOT, file));
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error('[server] handler error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('server error');
      }
    });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, pathname);
    return;
  }

  res.statusCode = 405;
  res.end('method not allowed');
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`t08 dev server listening on http://localhost:${port}`);
  });
}

module.exports = server;
