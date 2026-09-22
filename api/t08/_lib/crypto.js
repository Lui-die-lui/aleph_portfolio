'use strict';

const crypto = require('crypto');

function sessionSecret() {
  const secret = process.env.T08_SESSION_SECRET;
  if (!secret) {
    throw new Error('T08_SESSION_SECRET is not configured');
  }
  return secret;
}

// HMAC-SHA256 instead of plain SHA-256 for tokens/challenges/invite codes:
// the secret acts as a pepper so a stolen DB dump alone (token_hash /
// challenge_hash / invite token_hash columns) cannot be brute-forced or
// used to forge a match without also having T08_SESSION_SECRET.
function hmacHex(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value, 'utf8').digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { hmacHex, randomToken };
