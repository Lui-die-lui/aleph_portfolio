'use strict';

const { query } = require('./db');

async function upsertByUsername(username, displayName) {
  const result = await query(
    `insert into t08_users (username, display_name)
     values ($1, $2)
     on conflict (username) do update set display_name = excluded.display_name, updated_at = now()
     returning id`,
    [username, displayName]
  );
  return result.rows[0].id;
}

async function findByUsername(username) {
  const result = await query(`select id, username, display_name from t08_users where username = $1`, [
    username,
  ]);
  return result.rows[0] || null;
}

async function passkeyCount(userId) {
  const result = await query(`select count(*)::int as n from t08_passkeys where user_id = $1`, [
    userId,
  ]);
  return result.rows[0].n;
}

module.exports = { upsertByUsername, findByUsername, passkeyCount };
