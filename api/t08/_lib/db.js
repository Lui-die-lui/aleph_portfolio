'use strict';

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.SUPABASE_CONNECTION_KEY;
    if (!connectionString) {
      throw new Error('SUPABASE_CONNECTION_KEY is not configured');
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

module.exports = { query, withClient };
