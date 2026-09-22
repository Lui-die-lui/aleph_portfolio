// Mints a one-time, short-lived invite token for creating a NEW t08 account
// (e.g. the isolation-test account). The plaintext token is printed once to
// this terminal and is never written to the DB, a file, or any log — only
// its HMAC hash is stored.
//
// Usage: npm run t08:create-invite -- <username> <displayName>
'use strict';

const { query } = require('../api/t08/_lib/db');
const { hmacHex, randomToken } = require('../api/t08/_lib/crypto');

const INVITE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function main() {
  const [username, ...rest] = process.argv.slice(2);
  const displayName = rest.join(' ');

  if (!username || !displayName) {
    console.error('Usage: npm run t08:create-invite -- <username> <displayName>');
    process.exit(1);
  }
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    console.error('username must be 3-32 chars of a-z, 0-9, _ or -');
    process.exit(1);
  }

  const token = randomToken(32);
  const tokenHash = hmacHex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await query(
    `insert into t08_invite_tokens (token_hash, purpose, intended_username, intended_display_name, expires_at)
     values ($1, 'registration', $2, $3, $4)`,
    [tokenHash, username, displayName, expiresAt]
  );

  console.log('Invite created. This token is shown ONCE and expires in 15 minutes:');
  console.log(token);
  console.log(`Open locally: http://localhost:3000/t08-invite.html#token=${token}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to create invite:', err.message);
  process.exit(1);
});
