'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { query } = require('../../api/t08/_lib/db');
const { recordChallenge, consumeChallenge } = require('../../api/t08/_lib/challenge');
const { hmacHex } = require('../../api/t08/_lib/crypto');

test('a fresh challenge can be consumed exactly once', async () => {
  const challenge = 'unit-test-challenge-' + Date.now();
  await recordChallenge(challenge, 'registration', null);

  const first = await consumeChallenge(challenge, 'registration');
  assert.ok(first, 'first consume should succeed');

  const second = await consumeChallenge(challenge, 'registration');
  assert.equal(second, null, 'reusing an already-consumed challenge must be rejected');
});

test('an expired challenge is rejected even before first use', async () => {
  const challenge = 'unit-test-expired-' + Date.now();
  const challengeHash = hmacHex(challenge);
  await query(
    `insert into t08_auth_challenges (challenge_hash, purpose, expires_at)
     values ($1, 'authentication', now() - interval '1 minute')`,
    [challengeHash]
  );

  const result = await consumeChallenge(challenge, 'authentication');
  assert.equal(result, null, 'expired challenge must not be consumable');
});

test('a challenge recorded for one purpose cannot be consumed under another', async () => {
  const challenge = 'unit-test-purpose-' + Date.now();
  await recordChallenge(challenge, 'registration', null);

  const wrongPurpose = await consumeChallenge(challenge, 'authentication');
  assert.equal(wrongPurpose, null);

  const rightPurpose = await consumeChallenge(challenge, 'registration');
  assert.ok(rightPurpose);
});
