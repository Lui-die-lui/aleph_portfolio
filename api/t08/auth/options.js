'use strict';

const { generateAuthenticationOptions } = require('@simplewebauthn/server');
const { recordChallenge } = require('../_lib/challenge');
const { config } = require('../_lib/webauthn');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../_lib/http');

// Usernameless (discoverable-credential) login: no allowCredentials list is
// sent, so the browser lets the user pick from whichever passkeys for this
// RP it already has. No username/password field exists anywhere.
module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { rpID } = config();

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });

  await recordChallenge(options.challenge, 'authentication', null);

  sendJson(res, 200, options);
});
