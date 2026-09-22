'use strict';

const { query } = require('./db');
const { hmacHex } = require('./crypto');

// Read-only check used by the "options" step — does NOT mark the invite
// used, so the registration ceremony can be retried after a cancel.
async function peekInvite(rawToken) {
  const tokenHash = hmacHex(rawToken);
  const result = await query(
    `select id, intended_username, intended_display_name
       from t08_invite_tokens
      where token_hash = $1
        and used_at is null
        and expires_at > now()
      limit 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

// Atomically marks the invite used and returns its row — called only once
// registration is actually about to be verified, so a cancelled ceremony
// doesn't burn the one-time token.
async function consumeInvite(rawToken) {
  const tokenHash = hmacHex(rawToken);
  const result = await query(
    `update t08_invite_tokens
        set used_at = now()
      where token_hash = $1
        and used_at is null
        and expires_at > now()
      returning id, intended_username, intended_display_name`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

module.exports = { peekInvite, consumeInvite };
