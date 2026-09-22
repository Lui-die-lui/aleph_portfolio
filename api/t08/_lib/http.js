'use strict';

// Plain Node (req, res) helpers — deliberately not using @vercel/node's
// request/response sugar so the same handler works under `node server.js`
// (local dev + tests) and under Vercel's Node runtime without changes.

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, { error: 'method_not_allowed' });
}

// Wraps a handler so unexpected errors never leak stack traces, env values,
// or DB details to the client — only a generic message, per the "don't
// expose internals" rule. Real detail goes to the server log only.
function withErrorBoundary(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[t08] unhandled error:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'server_error' });
      }
    }
  };
}

module.exports = { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary };
