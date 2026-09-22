'use strict';

// These tests exercise the real HTTP verify endpoint with a syntactically
// valid but cryptographically fake WebAuthn response (no real authenticator
// involved). @simplewebauthn/server checks the challenge (via our
// expectedChallenge callback) and the origin before it ever tries to parse
// the attestation object, so a fake response can prove those two rejection
// paths without a genuine signature. It can never produce a *successful*
// registration — that needs a real authenticator ceremony, which is
// covered separately as a manual browser check (see docs/t08/VERIFICATION.md).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const server = require('../../server');
const { query } = require('../../api/t08/_lib/db');
const { createUser, seedSession, cleanupTestUsers } = require('./helpers');

let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await cleanupTestUsers();
  await new Promise((resolve) => server.close(resolve));
});

function req(pathname, options = {}) {
  return fetch(baseUrl + pathname, options);
}

function fakeRegistrationResponse(challenge, origin) {
  const id = crypto.randomBytes(16).toString('base64url');
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.create', challenge, origin })
  ).toString('base64url');
  return {
    id,
    rawId: id,
    type: 'public-key',
    response: {
      clientDataJSON,
      attestationObject: Buffer.from('not-a-real-attestation-object').toString('base64url'),
    },
    clientExtensionResults: {},
  };
}

async function passkeyCount(userId) {
  const result = await query('select count(*)::int as n from t08_passkeys where user_id = $1', [
    userId,
  ]);
  return result.rows[0].n;
}

test('a garbage attestation object is rejected and nothing is stored', async () => {
  const user = await createUser('reject_garbage', 'Reject Garbage');
  const cookie = await seedSession(user.id);

  const optionsRes = await req('/api/t08/passkeys/register/options', {
    method: 'POST',
    headers: { cookie },
  });
  const options = await optionsRes.json();

  const before_ = await passkeyCount(user.id);
  assert.equal(before_, 0);

  const verifyRes = await req('/api/t08/passkeys/register/verify', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response: fakeRegistrationResponse(options.challenge, 'http://localhost:3000'),
      deviceName: 'fake device',
    }),
  });

  assert.equal(verifyRes.status, 400);
  assert.equal(await passkeyCount(user.id), 0, 'a failed registration must not store a credential');
});

test('a response claiming the wrong origin is rejected', async () => {
  const user = await createUser('reject_origin', 'Reject Origin');
  const cookie = await seedSession(user.id);

  const optionsRes = await req('/api/t08/passkeys/register/options', {
    method: 'POST',
    headers: { cookie },
  });
  const options = await optionsRes.json();

  const verifyRes = await req('/api/t08/passkeys/register/verify', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response: fakeRegistrationResponse(options.challenge, 'https://evil.example'),
      deviceName: 'fake device',
    }),
  });

  assert.equal(verifyRes.status, 400);
  assert.equal(await passkeyCount(user.id), 0);
});

test('replaying the same challenge a second time never succeeds', async () => {
  const user = await createUser('reject_replay', 'Reject Replay');
  const cookie = await seedSession(user.id);

  const optionsRes = await req('/api/t08/passkeys/register/options', {
    method: 'POST',
    headers: { cookie },
  });
  const options = await optionsRes.json();
  const fake = fakeRegistrationResponse(options.challenge, 'http://localhost:3000');

  const first = await req('/api/t08/passkeys/register/verify', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: fake, deviceName: 'fake device' }),
  });
  assert.equal(first.status, 400);

  const second = await req('/api/t08/passkeys/register/verify', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: fake, deviceName: 'fake device' }),
  });
  assert.equal(second.status, 400);
  assert.equal(await passkeyCount(user.id), 0);
});
