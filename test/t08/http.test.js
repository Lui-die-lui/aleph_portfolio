'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const server = require('../../server');
const {
  createUser,
  seedSession,
  seedPasskey,
  seedPrivateItems,
  cleanupTestUsers,
} = require('./helpers');

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

// --- 1. Unauthenticated requests to private routes ---

test('GET /api/t08/private-items without a session -> 401', async () => {
  const res = await req('/api/t08/private-items');
  assert.equal(res.status, 401);
});

test('GET /api/t08/passkeys without a session -> 401', async () => {
  const res = await req('/api/t08/passkeys');
  assert.equal(res.status, 401);
});

test('DELETE /api/t08/passkeys/:id without a session -> 401', async () => {
  const res = await req('/api/t08/passkeys/00000000-0000-0000-0000-000000000000', {
    method: 'DELETE',
  });
  assert.equal(res.status, 401);
});

test('GET /api/t08/auth/session without a cookie -> 401, authenticated:false', async () => {
  const res = await req('/api/t08/auth/session');
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.authenticated, false);
});

// --- 2/6/7. Ownership isolation between two accounts ---

test('a logged-in user only ever sees their own private items, even if a different userId is requested', async () => {
  const userA = await createUser('owner_a', 'Owner A');
  const userB = await createUser('owner_b', 'Owner B');
  await seedPrivateItems(userA.id, [
    { title: 'A item 1', content: 'a1', category: 'note' },
    { title: 'A item 2', content: 'a2', category: 'note' },
  ]);
  await seedPrivateItems(userB.id, [{ title: 'B item 1', content: 'b1', category: 'note' }]);
  const cookieA = await seedSession(userA.id);

  const res = await req(`/api/t08/private-items?userId=${userB.id}`, {
    headers: { cookie: cookieA },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.items.length, 2);
  assert.ok(body.items.every((item) => item.title.startsWith('A item')));

  const cookieB = await seedSession(userB.id);
  const resB = await req(`/api/t08/private-items?userId=${userA.id}`, {
    headers: { cookie: cookieB },
  });
  const bodyB = await resB.json();
  assert.equal(resB.status, 200);
  assert.equal(bodyB.items.length, 1);
  assert.equal(bodyB.items[0].title, 'B item 1');
});

// --- 5. Logout invalidates the session ---

test('after logout, the old session cookie is rejected', async () => {
  const user = await createUser('logout_flow', 'Logout Flow');
  const cookie = await seedSession(user.id);

  const before_ = await req('/api/t08/auth/session', { headers: { cookie } });
  assert.equal(before_.status, 200);

  const logoutRes = await req('/api/t08/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logoutRes.status, 200);

  const afterRes = await req('/api/t08/private-items', { headers: { cookie } });
  assert.equal(afterRes.status, 401);
});

// --- 8/9/10. Multiple passkeys, ownership on delete, last-passkey guard ---

test('deleting another account\'s passkey is rejected (404), own passkey succeeds, last one is protected (409)', async () => {
  const userA = await createUser('passkeys_a', 'Passkeys A');
  const userB = await createUser('passkeys_b', 'Passkeys B');
  const aKey1 = await seedPasskey(userA.id, { credentialId: 'cred-a-1-' + Date.now(), deviceName: 'A phone' });
  const aKey2 = await seedPasskey(userA.id, { credentialId: 'cred-a-2-' + Date.now(), deviceName: 'A laptop' });
  const bKey1 = await seedPasskey(userB.id, { credentialId: 'cred-b-1-' + Date.now(), deviceName: 'B phone' });
  const cookieA = await seedSession(userA.id);

  // A cannot delete B's passkey.
  const crossDelete = await req(`/api/t08/passkeys/${bKey1}`, {
    method: 'DELETE',
    headers: { cookie: cookieA },
  });
  assert.equal(crossDelete.status, 404);

  // Cross-account attempt changed nothing for B.
  const cookieB = await seedSession(userB.id);
  const bList = await req('/api/t08/passkeys', { headers: { cookie: cookieB } });
  const bBody = await bList.json();
  assert.equal(bBody.passkeys.length, 1);

  // A deletes their own first passkey — succeeds, one remains.
  const ownDelete = await req(`/api/t08/passkeys/${aKey1}`, {
    method: 'DELETE',
    headers: { cookie: cookieA },
  });
  assert.equal(ownDelete.status, 200);

  // A's last remaining passkey cannot be deleted.
  const lastDelete = await req(`/api/t08/passkeys/${aKey2}`, {
    method: 'DELETE',
    headers: { cookie: cookieA },
  });
  assert.equal(lastDelete.status, 409);

  const aList = await req('/api/t08/passkeys', { headers: { cookie: cookieA } });
  const aBody = await aList.json();
  assert.equal(aBody.passkeys.length, 1, 'the last passkey must still be there');
});

// --- Bootstrap is only reachable while the flag is on ---

test('bootstrap registration is refused once T08_BOOTSTRAP_ENABLED is not "true"', async () => {
  const original = process.env.T08_BOOTSTRAP_ENABLED;
  process.env.T08_BOOTSTRAP_ENABLED = 'false';
  try {
    const res = await req('/api/t08/bootstrap/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Should Not Work' }),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error, 'bootstrap_disabled');
  } finally {
    process.env.T08_BOOTSTRAP_ENABLED = original;
  }
});

// --- Invite tokens ---

test('invite registration is refused for an unknown/invalid token', async () => {
  const res = await req('/api/t08/invite/register/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'not-a-real-token' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'invalid_invite');
});
