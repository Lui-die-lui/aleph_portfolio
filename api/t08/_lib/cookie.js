'use strict';

// Minimal, dependency-free replacement for the `cookie` npm package.
//
// cookie@2.x is published ESM-only (package.json has "type": "module" and
// no CJS entry point). `require('cookie')` from this CommonJS codebase
// happened to work in local dev/tests only because Node 22's native
// require(esm) support silently loaded it — but it crashes Vercel's
// deployed runtime with ERR_REQUIRE_ESM ("Node.js process exited with
// exit status: 1"), taking down every route that (transitively) requires
// session.js. Only the two functions actually used (parse a Cookie
// request header, serialize one Set-Cookie response header) are
// implemented here, so there's no module-format footgun going forward.

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    try {
      out[key] = decodeURIComponent(value);
    } catch (_) {
      out[key] = value;
    }
  }
  return out;
}

function stringifySetCookie({ name, value, httpOnly, secure, sameSite, path, maxAge }) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (path) parts.push(`Path=${path}`);
  if (sameSite) parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = { parseCookie, stringifySetCookie };
