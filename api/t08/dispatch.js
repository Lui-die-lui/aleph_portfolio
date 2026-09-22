'use strict';

// Single catch-all Vercel Serverless Function for the t08 passkey routes
// below /api/t08/ that each used to be their own file (their own function).
// Consolidated ONLY to stay under the Hobby plan's 12-function limit —
// every handler body below, and every _lib/* security check it calls
// (challenge single-use/expiry, session lookup, ownership checks), is
// copied unchanged from its original standalone route file into
// ./_lib/handlers/*.js. Nothing about auth/security behavior changed here.
//
// This file is deliberately named plainly (not `[...path].js`). Vercel's
// zero-config bracket catch-all only reliably matches 0-1 path segments
// for non-Next.js projects — a request for something 2+ segments deep
// (e.g. /api/t08/auth/options) gets Vercel's own synthetic 404 before this
// function is ever invoked. Reaching this file for every /api/t08/* depth
// instead relies on the rewrite in vercel.json, which forwards the
// request here while leaving req.url as the original requested path (a
// Vercel rewrite does not rewrite req.url itself), so the parsing below
// still sees e.g. "/api/t08/auth/options" unchanged.
//
// api/t08/bootstrap/** and api/t08/invite/** are intentionally NOT routed
// through this file — they stay as their own (flag-gated / rarely used)
// functions. Vercel matches an existing static file (e.g.
// api/t08/bootstrap/register/options.js) before applying any rewrite, so
// both keep working unchanged side by side with no explicit exclusion
// needed in vercel.json.
//
// The path/method dispatch below parses req.url directly (not
// req.query) so this file behaves identically under Vercel's Node
// runtime and under the plain http.Server used for local dev + tests,
// exactly like the standalone handlers it replaces did.

const { sendJson } = require('./_lib/http');
const authOptions = require('./_lib/handlers/authOptions');
const authVerify = require('./_lib/handlers/authVerify');
const authLogout = require('./_lib/handlers/authLogout');
const authSession = require('./_lib/handlers/authSession');
const privateItemsList = require('./_lib/handlers/privateItemsList');
const privateItemsCreate = require('./_lib/handlers/privateItemsCreate');
const privateItemsUpdate = require('./_lib/handlers/privateItemsUpdate');
const privateItemsDelete = require('./_lib/handlers/privateItemsDelete');
const passkeysList = require('./_lib/handlers/passkeysList');
const passkeysDelete = require('./_lib/handlers/passkeysDelete');
const passkeysRegisterOptions = require('./_lib/handlers/passkeysRegisterOptions');
const passkeysRegisterVerify = require('./_lib/handlers/passkeysRegisterVerify');

module.exports = async function handler(req, res) {
  const pathname = req.url.split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  // '/api/t08/passkeys/register/options' -> ['api','t08','passkeys','register','options']
  const tail = segments.slice(2);
  const key = tail.join('/');
  const method = req.method;

  if (method === 'POST' && key === 'passkeys/register/options') {
    return passkeysRegisterOptions(req, res);
  }
  if (method === 'POST' && key === 'passkeys/register/verify') {
    return passkeysRegisterVerify(req, res);
  }
  if (method === 'POST' && key === 'auth/options') {
    return authOptions(req, res);
  }
  if (method === 'POST' && key === 'auth/verify') {
    return authVerify(req, res);
  }
  if (method === 'POST' && key === 'auth/logout') {
    return authLogout(req, res);
  }
  if (method === 'GET' && key === 'auth/session') {
    return authSession(req, res);
  }
  if (method === 'GET' && key === 'private-items') {
    return privateItemsList(req, res);
  }
  if (method === 'POST' && key === 'private-items') {
    return privateItemsCreate(req, res);
  }
  if (method === 'GET' && key === 'passkeys') {
    return passkeysList(req, res);
  }
  // DELETE /api/t08/passkeys/:id — any single segment except 'register'
  // (which is reserved for the register/options|verify routes above).
  if (method === 'DELETE' && tail.length === 2 && tail[0] === 'passkeys' && tail[1] !== 'register') {
    return passkeysDelete(req, res);
  }
  // PATCH/DELETE /api/t08/private-items/:id
  if (method === 'PATCH' && tail.length === 2 && tail[0] === 'private-items') {
    return privateItemsUpdate(req, res);
  }
  if (method === 'DELETE' && tail.length === 2 && tail[0] === 'private-items') {
    return privateItemsDelete(req, res);
  }

  sendJson(res, 404, { error: 'not_found' });
};
