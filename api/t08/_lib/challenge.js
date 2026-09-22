'use strict';

const { query } = require('./db');
const { hmacHex } = require('./crypto');

const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes — short-lived, per-request

// Stores only the HMAC hash of a challenge that generateRegistrationOptions
// / generateAuthenticationOptions already generated. userId is null for
// usernameless (discoverable-credential) authentication challenges.
async function recordChallenge(challenge, purpose, userId = null) {
  const challengeHash = hmacHex(challenge);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await query(
    `insert into t08_auth_challenges (user_id, challenge_hash, purpose, expires_at)
     values ($1, $2, $3, $4)`,
    [userId, challengeHash, purpose, expiresAt]
  );
}

// Atomically checks the challenge is unexpired and unused, and marks it
// used in the same statement — so a valid challenge can never be replayed,
// and this happens regardless of whether the surrounding signature
// verification later succeeds or fails.
async function consumeChallenge(challenge, purpose) {
  const challengeHash = hmacHex(challenge);
  const result = await query(
    `update t08_auth_challenges
        set used_at = now()
      where challenge_hash = $1
        and purpose = $2
        and used_at is null
        and expires_at > now()
      returning id, user_id`,
    [challengeHash, purpose]
  );
  return result.rows[0] || null;
}

module.exports = { recordChallenge, consumeChallenge, CHALLENGE_TTL_MS };
