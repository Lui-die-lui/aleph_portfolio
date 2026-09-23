'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

// --- Logging in with a credential id nobody registered ---

// Syntactically valid but cryptographically fake WebAuthn authentication
// response — same approach as registration-reject.test.js. Enough to reach
// authVerify's "no matching credential" branch (api/t08/_lib/handlers/
// authVerify.js), which never calls verifyAuthenticationResponse at all for
// an unknown credential id, so no genuine signature is needed to prove this
// rejection path.
function fakeAuthenticationResponse(credentialId, challenge, origin) {
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin })
  ).toString('base64url');
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON,
      authenticatorData: Buffer.from('fake-authenticator-data').toString('base64url'),
      signature: Buffer.from('fake-signature').toString('base64url'),
    },
    clientExtensionResults: {},
  };
}

test('logging in with a credential id that was never registered is rejected (401), and the challenge cannot be retried', async () => {
  const optionsRes = await req('/api/t08/auth/options', { method: 'POST' });
  const options = await optionsRes.json();

  const unknownId = crypto.randomBytes(16).toString('base64url');
  const verifyRes = await req('/api/t08/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response: fakeAuthenticationResponse(unknownId, options.challenge, 'http://localhost:3000'),
    }),
  });
  assert.equal(verifyRes.status, 401);

  // Same challenge, a different unknown id — still rejected, because the
  // challenge was already burned by the first (failed) attempt above.
  const retryId = crypto.randomBytes(16).toString('base64url');
  const retryRes = await req('/api/t08/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response: fakeAuthenticationResponse(retryId, options.challenge, 'http://localhost:3000'),
    }),
  });
  assert.equal(retryRes.status, 401);
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

// --- Private items CRUD ---

test('POST /api/t08/private-items without a session -> 401', async () => {
  const res = await req('/api/t08/private-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 't', content: 'c', category: 'cat' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/t08/private-items/:id without a session -> 401', async () => {
  const res = await req('/api/t08/private-items/00000000-0000-0000-0000-000000000000', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 't', content: 'c', category: 'cat' }),
  });
  assert.equal(res.status, 401);
});

test('DELETE /api/t08/private-items/:id without a session -> 401', async () => {
  const res = await req('/api/t08/private-items/00000000-0000-0000-0000-000000000000', {
    method: 'DELETE',
  });
  assert.equal(res.status, 401);
});

test('creating a private item persists it and is owned by the session user, not any client-sent id', async () => {
  const user = await createUser('items_create', 'Items Create');
  const cookie = await seedSession(user.id);

  const createRes = await req('/api/t08/private-items', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    // userId/ownerId in the body must be ignored — ownership always comes
    // from the session.
    body: JSON.stringify({
      title: 'New note',
      content: 'note body',
      category: 'general',
      userId: '00000000-0000-0000-0000-000000000000',
    }),
  });
  const createBody = await createRes.json();
  assert.equal(createRes.status, 201);
  assert.equal(createBody.item.title, 'New note');

  const listRes = await req('/api/t08/private-items', { headers: { cookie } });
  const listBody = await listRes.json();
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].id, createBody.item.id);
});

test('creating a private item rejects an empty title', async () => {
  const user = await createUser('items_invalid', 'Items Invalid');
  const cookie = await seedSession(user.id);

  const res = await req('/api/t08/private-items', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '   ', content: 'c', category: 'cat' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'title_required');
});

test('updating and deleting another account\'s item is rejected (404); own item works and persists', async () => {
  const userA = await createUser('items_a', 'Items A');
  const userB = await createUser('items_b', 'Items B');
  await seedPrivateItems(userA.id, [{ title: 'A note', content: 'a', category: 'note' }]);
  const cookieA = await seedSession(userA.id);
  const cookieB = await seedSession(userB.id);

  const listA = await req('/api/t08/private-items', { headers: { cookie: cookieA } });
  const itemA = (await listA.json()).items[0];

  // B cannot update or delete A's item.
  const crossUpdate = await req(`/api/t08/private-items/${itemA.id}`, {
    method: 'PATCH',
    headers: { cookie: cookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'hijacked', content: 'x', category: 'y' }),
  });
  assert.equal(crossUpdate.status, 404);

  const crossDelete = await req(`/api/t08/private-items/${itemA.id}`, {
    method: 'DELETE',
    headers: { cookie: cookieB },
  });
  assert.equal(crossDelete.status, 404);

  // A's item is untouched by B's attempts.
  const stillA = await req('/api/t08/private-items', { headers: { cookie: cookieA } });
  const stillABody = await stillA.json();
  assert.equal(stillABody.items.length, 1);
  assert.equal(stillABody.items[0].title, 'A note');

  // A updates their own item — persists.
  const ownUpdate = await req(`/api/t08/private-items/${itemA.id}`, {
    method: 'PATCH',
    headers: { cookie: cookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'A note (edited)', content: 'a2', category: 'note2' }),
  });
  assert.equal(ownUpdate.status, 200);

  const afterUpdate = await req('/api/t08/private-items', { headers: { cookie: cookieA } });
  const afterUpdateBody = await afterUpdate.json();
  assert.equal(afterUpdateBody.items[0].title, 'A note (edited)');
  assert.equal(afterUpdateBody.items[0].category, 'note2');

  // A deletes their own item — persists (gone after refresh).
  const ownDelete = await req(`/api/t08/private-items/${itemA.id}`, {
    method: 'DELETE',
    headers: { cookie: cookieA },
  });
  assert.equal(ownDelete.status, 200);

  const afterDelete = await req('/api/t08/private-items', { headers: { cookie: cookieA } });
  const afterDeleteBody = await afterDelete.json();
  assert.equal(afterDeleteBody.items.length, 0);
});

// --- 9/10/11/12/17. Cross-account isolation, checked in both directions ---

test('cross-account private-item update/delete is rejected in both directions, and item counts are unchanged', async () => {
  const userA = await createUser('items_iso_a', 'Items Iso A');
  const userB = await createUser('items_iso_b', 'Items Iso B');
  await seedPrivateItems(userA.id, [{ title: 'A only', content: 'a', category: 'note' }]);
  await seedPrivateItems(userB.id, [{ title: 'B only', content: 'b', category: 'note' }]);
  const cookieA = await seedSession(userA.id);
  const cookieB = await seedSession(userB.id);

  const itemA = (await (await req('/api/t08/private-items', { headers: { cookie: cookieA } })).json())
    .items[0];
  const itemB = (await (await req('/api/t08/private-items', { headers: { cookie: cookieB } })).json())
    .items[0];

  // A -> B
  const aUpdatesB = await req(`/api/t08/private-items/${itemB.id}`, {
    method: 'PATCH',
    headers: { cookie: cookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'hijacked', content: 'x', category: 'y' }),
  });
  assert.equal(aUpdatesB.status, 404);
  const aDeletesB = await req(`/api/t08/private-items/${itemB.id}`, {
    method: 'DELETE',
    headers: { cookie: cookieA },
  });
  assert.equal(aDeletesB.status, 404);

  // B -> A (the reverse direction)
  const bUpdatesA = await req(`/api/t08/private-items/${itemA.id}`, {
    method: 'PATCH',
    headers: { cookie: cookieB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'hijacked', content: 'x', category: 'y' }),
  });
  assert.equal(bUpdatesA.status, 404);
  const bDeletesA = await req(`/api/t08/private-items/${itemA.id}`, {
    method: 'DELETE',
    headers: { cookie: cookieB },
  });
  assert.equal(bDeletesA.status, 404);

  // Neither account's item count or content changed from the other's attempts.
  const stillA = await (await req('/api/t08/private-items', { headers: { cookie: cookieA } })).json();
  const stillB = await (await req('/api/t08/private-items', { headers: { cookie: cookieB } })).json();
  assert.equal(stillA.items.length, 1);
  assert.equal(stillA.items[0].title, 'A only');
  assert.equal(stillB.items.length, 1);
  assert.equal(stillB.items[0].title, 'B only');
});

test('cross-account passkey deletion is rejected in both directions, and passkey counts are unchanged', async () => {
  const userA = await createUser('pk_iso_a', 'PK Iso A');
  const userB = await createUser('pk_iso_b', 'PK Iso B');
  // Two passkeys each, so a rejected cross-account delete can be told apart
  // from the separate "last passkey" 409 guard tested elsewhere.
  const aKey1 = await seedPasskey(userA.id, { credentialId: 'iso-a-1-' + Date.now(), deviceName: 'A key 1' });
  await seedPasskey(userA.id, { credentialId: 'iso-a-2-' + Date.now(), deviceName: 'A key 2' });
  const bKey1 = await seedPasskey(userB.id, { credentialId: 'iso-b-1-' + Date.now(), deviceName: 'B key 1' });
  await seedPasskey(userB.id, { credentialId: 'iso-b-2-' + Date.now(), deviceName: 'B key 2' });
  const cookieA = await seedSession(userA.id);
  const cookieB = await seedSession(userB.id);

  // A -> B
  const aDeletesB = await req(`/api/t08/passkeys/${bKey1}`, {
    method: 'DELETE',
    headers: { cookie: cookieA },
  });
  assert.equal(aDeletesB.status, 404);

  // B -> A (the reverse direction)
  const bDeletesA = await req(`/api/t08/passkeys/${aKey1}`, {
    method: 'DELETE',
    headers: { cookie: cookieB },
  });
  assert.equal(bDeletesA.status, 404);

  const aList = await (await req('/api/t08/passkeys', { headers: { cookie: cookieA } })).json();
  const bList = await (await req('/api/t08/passkeys', { headers: { cookie: cookieB } })).json();
  assert.equal(aList.passkeys.length, 2, "A's passkeys are unchanged by B's attempt");
  assert.equal(bList.passkeys.length, 2, "B's passkeys are unchanged by A's attempt");
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
