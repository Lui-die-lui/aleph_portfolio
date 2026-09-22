'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { requireSession, revokeSession } = require('../../api/t08/_lib/session');
const { createUser, seedSession, cleanupTestUsers } = require('./helpers');

// Minimal fake ServerResponse: only needs setHeader() for the functions
// under test (createSession/revokeSession) to run.
function fakeRes() {
  const headers = {};
  return { setHeader: (k, v) => (headers[k] = v), headers };
}

function fakeReq(cookieHeader) {
  const req = new EventEmitter();
  req.headers = cookieHeader ? { cookie: cookieHeader } : {};
  return req;
}

after(cleanupTestUsers);

test('requireSession returns null when there is no cookie', async () => {
  const session = await requireSession(fakeReq(null));
  assert.equal(session, null);
});

test('requireSession returns null for a garbage cookie value', async () => {
  const session = await requireSession(fakeReq('t08_session=not-a-real-token'));
  assert.equal(session, null);
});

test('a valid, unexpired session resolves to its owning user', async () => {
  const user = await createUser('session_valid', 'Session Valid');
  const cookie = await seedSession(user.id);

  const session = await requireSession(fakeReq(cookie));
  assert.ok(session);
  assert.equal(session.userId, user.id);
});

test('an expired session is rejected', async () => {
  const user = await createUser('session_expired', 'Session Expired');
  const cookie = await seedSession(user.id, { expiresInMs: -1000 });

  const session = await requireSession(fakeReq(cookie));
  assert.equal(session, null);
});

test('a revoked session is rejected', async () => {
  const user = await createUser('session_revoked', 'Session Revoked');
  const cookie = await seedSession(user.id, { revoked: true });

  const session = await requireSession(fakeReq(cookie));
  assert.equal(session, null);
});

test('revokeSession invalidates a previously valid session (logout)', async () => {
  const user = await createUser('session_logout', 'Session Logout');
  const cookie = await seedSession(user.id);
  const rawToken = cookie.split('=')[1];

  const before = await requireSession(fakeReq(cookie));
  assert.ok(before, 'session should be valid before logout');

  await revokeSession(fakeRes(), rawToken);

  const after_ = await requireSession(fakeReq(cookie));
  assert.equal(after_, null, 'session must be rejected after logout');
});
