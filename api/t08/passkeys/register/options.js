'use strict';

const { generateRegistrationOptions } = require('@simplewebauthn/server');
const { requireSession } = require('../../_lib/session');
const { recordChallenge } = require('../../_lib/challenge');
const { listCredentialDescriptorsByUser } = require('../../_lib/passkeys');
const { config } = require('../../_lib/webauthn');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../../_lib/http');

// Adding a passkey (the 1st or the 5th) always requires an existing,
// logged-in session — there is no unauthenticated way to reach this route.
// The very first passkey for the owner account is created by the separate,
// flag-gated bootstrap flow instead (see api/t08/bootstrap).
module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const { rpID, rpName } = config();
  const excludeCredentials = await listCredentialDescriptorsByUser(session.userId);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: session.username,
    userID: Buffer.from(session.userId, 'utf8'),
    userDisplayName: session.displayName,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  await recordChallenge(options.challenge, 'registration', session.userId);

  sendJson(res, 200, options);
});
