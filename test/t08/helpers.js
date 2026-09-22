'use strict';

const { query } = require('../../api/t08/_lib/db');
const { hmacHex, randomToken } = require('../../api/t08/_lib/crypto');

const PREFIX = 't08test_';

// node's test runner runs each *.test.js file as its own concurrent
// process, all sharing one remote database. A per-file random namespace
// (rather than a shared 't08test_' wildcard) keeps createUser/cleanup calls
// from one file from ever touching another file's still-running fixtures.
const NAMESPACE = process.pid + '_' + Math.random().toString(36).slice(2, 8);

async function createUser(suffix, displayName) {
  const username = `${PREFIX}${NAMESPACE}_${suffix}`;
  const result = await query(
    `insert into t08_users (username, display_name) values ($1, $2)
     on conflict (username) do update set display_name = excluded.display_name
     returning id`,
    [username, displayName || suffix]
  );
  return { id: result.rows[0].id, username };
}

// Bypasses the real WebAuthn ceremony to seed a session directly, the same
// way api/t08/_lib/session.js's createSession would, so HTTP-level tests
// can assert on ownership/expiry without a live authenticator.
async function seedSession(userId, { expiresInMs = 60 * 60 * 1000, revoked = false } = {}) {
  const rawToken = randomToken(24);
  const tokenHash = hmacHex(rawToken);
  const expiresAt = new Date(Date.now() + expiresInMs);
  const revokedAt = revoked ? new Date() : null;
  await query(
    `insert into t08_sessions (user_id, token_hash, expires_at, revoked_at) values ($1, $2, $3, $4)`,
    [userId, tokenHash, expiresAt, revokedAt]
  );
  return `t08_session=${rawToken}`;
}

async function seedPasskey(userId, { credentialId, deviceName }) {
  const result = await query(
    `insert into t08_passkeys (user_id, credential_id, public_key, counter, device_name)
     values ($1, $2, $3, 0, $4)
     returning id`,
    [userId, credentialId, Buffer.from('dummy-public-key').toString('base64url'), deviceName || 'test key']
  );
  return result.rows[0].id;
}

async function seedPrivateItems(userId, items) {
  for (const item of items) {
    await query(
      `insert into t08_private_items (user_id, title, content, category) values ($1, $2, $3, $4)`,
      [userId, item.title, item.content, item.category]
    );
  }
}

async function cleanupTestUsers() {
  // Scoped to this process's own namespace only — never a bare
  // 't08test_%' wildcard, which would also match fixtures that a
  // concurrently-running test file hasn't finished with yet.
  await query(`delete from t08_users where username like $1`, [`${PREFIX}${NAMESPACE}_%`]);
}

async function cleanupTestInvites() {
  await query(`delete from t08_invite_tokens where intended_username like $1`, [
    `${PREFIX}${NAMESPACE}_%`,
  ]);
}

module.exports = {
  PREFIX,
  createUser,
  seedSession,
  seedPasskey,
  seedPrivateItems,
  cleanupTestUsers,
  cleanupTestInvites,
};
