// Applies db/migrations/t08_*.sql (in filename order) against
// SUPABASE_CONNECTION_KEY. Run with: npm run t08:migrate
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.SUPABASE_CONNECTION_KEY;
  if (!connectionString) {
    console.error('SUPABASE_CONNECTION_KEY is not set.');
    process.exit(1);
  }

  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('t08_') && f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No t08_*.sql migrations found.');
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`Applying ${file} ...`);
      await client.query(sql);
      console.log(`  done.`);
    }
    console.log('All t08 migrations applied.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
