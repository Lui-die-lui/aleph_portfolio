'use strict';

const { generateRegistrationOptions } = require('@simplewebauthn/server');
const { recordChallenge } = require('../../_lib/challenge');
const { upsertByUsername, findByUsername, passkeyCount } = require('../../_lib/users');
const { config } = require('../../_lib/webauthn');
const { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary } = require('../../_lib/http');

const OWNER_USERNAME = 'owner';

// Only reachable when T08_BOOTSTRAP_ENABLED=true, which must never be set
// in the production (Vercel) environment — only in a local .env used once
// to register the operator's first passkey. It is further guarded by "the
// owner account must not already have a passkey", so it self-disables the
// moment bootstrap has actually succeeded once, even if the flag is left on.
module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  if (process.env.T08_BOOTSTRAP_ENABLED !== 'true') {
    return sendJson(res, 403, { error: 'bootstrap_disabled' });
  }

  const existingOwner = await findByUsername(OWNER_USERNAME);
  if (existingOwner) {
    const n = await passkeyCount(existingOwner.id);
    if (n > 0) {
      return sendJson(res, 403, { error: 'bootstrap_already_used' });
    }
  }

  const body = await readJsonBody(req);
  const displayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 80)
      : 'Owner';

  const userId = await upsertByUsername(OWNER_USERNAME, displayName);
  const { rpID, rpName } = config();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: OWNER_USERNAME,
    userID: Buffer.from(userId, 'utf8'),
    userDisplayName: displayName,
    attestationType: 'none',
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  await recordChallenge(options.challenge, 'registration', userId);

  sendJson(res, 200, options);
});
