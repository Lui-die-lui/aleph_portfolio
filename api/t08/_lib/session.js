'use strict';

// parseCookie reads a request's Cookie header, stringifySetCookie builds
// one Set-Cookie header entry. See ./cookie.js for why this is a small
// local implementation rather than the `cookie` npm package.
const { parseCookie, stringifySetCookie } = require('./cookie');
const { query } = require('./db');
const { hmacHex, randomToken } = require('./crypto');

const COOKIE_NAME = 't08_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function serializeSessionCookie(rawToken, maxAgeMs) {
  return stringifySetCookie({
    name: COOKIE_NAME,
    value: rawToken,
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

function serializeExpiredCookie() {
  return stringifySetCookie({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

function readSessionCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = parseCookie(header);
  return parsed[COOKIE_NAME] || null;
}

// Creates a brand-new random session token, stores only its HMAC hash, and
// returns the Set-Cookie header value carrying the raw token. The raw token
// is never written to the DB or logs.
async function createSession(res, userId) {
  const rawToken = randomToken(32);
  const tokenHash = hmacHex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `insert into t08_sessions (user_id, token_hash, expires_at) values ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
  res.setHeader('Set-Cookie', serializeSessionCookie(rawToken, SESSION_TTL_MS));
  return rawToken;
}

// Looks up the current session strictly by the server-issued token hash —
// never by any user-supplied id/userId — and only returns a session that
// is unrevoked and unexpired. This is the single source of truth for "who
// is the current user" used by every private route.
async function requireSession(req) {
  const rawToken = readSessionCookie(req);
  if (!rawToken) return null;
  const tokenHash = hmacHex(rawToken);
  const result = await query(
    `select s.id as session_id, u.id as user_id, u.username, u.display_name
       from t08_sessions s
       join t08_users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1`,
    [tokenHash]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    rawToken,
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
  };
}

async function revokeSession(res, rawToken) {
  if (rawToken) {
    const tokenHash = hmacHex(rawToken);
    await query(
      `update t08_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`,
      [tokenHash]
    );
  }
  res.setHeader('Set-Cookie', serializeExpiredCookie());
}

module.exports = { createSession, requireSession, revokeSession, readSessionCookie };
