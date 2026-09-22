'use strict';

const { query, withClient } = require('./db');

async function listByUser(userId) {
  const result = await query(
    `select id, credential_id, device_name, device_type, backed_up, created_at, last_used_at
       from t08_passkeys
      where user_id = $1
      order by created_at asc`,
    [userId]
  );
  return result.rows;
}

async function listCredentialDescriptorsByUser(userId) {
  const result = await query(
    `select credential_id, transports from t08_passkeys where user_id = $1`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: row.credential_id,
    transports: row.transports ? row.transports.split(',') : undefined,
  }));
}

async function findByCredentialId(credentialId) {
  const result = await query(
    `select id, user_id, credential_id, public_key, counter, transports
       from t08_passkeys
      where credential_id = $1
      limit 1`,
    [credentialId]
  );
  return result.rows[0] || null;
}

async function insert({
  userId,
  credentialId,
  publicKeyBase64Url,
  counter,
  transports,
  deviceType,
  backedUp,
  deviceName,
}) {
  const result = await query(
    `insert into t08_passkeys
       (user_id, credential_id, public_key, counter, transports, device_type, backed_up, device_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      userId,
      credentialId,
      publicKeyBase64Url,
      counter,
      transports && transports.length ? transports.join(',') : null,
      deviceType || null,
      Boolean(backedUp),
      deviceName,
    ]
  );
  return result.rows[0].id;
}

async function touchAfterLogin(credentialId, newCounter) {
  await query(
    `update t08_passkeys set counter = $2, last_used_at = now() where credential_id = $1`,
    [credentialId, newCounter]
  );
}

// Deletes a passkey only if it belongs to the given user AND at least one
// other passkey would remain — the "never delete your last key" rule.
// Returns 'deleted' | 'not_found' | 'last_remaining'.
async function deleteOwned(userId, passkeyId) {
  return withClient(async (client) => {
    await client.query('begin');
    try {
      const countResult = await client.query(
        `select count(*)::int as n from t08_passkeys where user_id = $1`,
        [userId]
      );
      if (countResult.rows[0].n <= 1) {
        await client.query('rollback');
        return 'last_remaining';
      }
      const deleteResult = await client.query(
        `delete from t08_passkeys where id = $1 and user_id = $2 returning id`,
        [passkeyId, userId]
      );
      await client.query('commit');
      return deleteResult.rows.length > 0 ? 'deleted' : 'not_found';
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  });
}

module.exports = {
  listByUser,
  listCredentialDescriptorsByUser,
  findByCredentialId,
  insert,
  touchAfterLogin,
  deleteOwned,
};
