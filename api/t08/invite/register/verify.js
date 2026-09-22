'use strict';

const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const { consumeChallenge } = require('../../_lib/challenge');
const { consumeInvite } = require('../../_lib/invites');
const { findByUsername } = require('../../_lib/users');
const { insert } = require('../../_lib/passkeys');
const { createSession } = require('../../_lib/session');
const { config } = require('../../_lib/webauthn');
const { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary } = require('../../_lib/http');

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const body = await readJsonBody(req);
  const token = typeof body.token === 'string' ? body.token : '';
  const response = body.response;
  const deviceName =
    typeof body.deviceName === 'string' && body.deviceName.trim()
      ? body.deviceName.trim().slice(0, 80)
      : '첫 패스키';

  if (!token) return sendJson(res, 400, { error: 'missing_token' });
  if (!response) return sendJson(res, 400, { error: 'missing_response' });

  // Consume the invite before touching the WebAuthn response at all: a
  // reused or expired token is rejected without ever attempting signature
  // verification, and a valid token can't be consumed twice even under a
  // race (single atomic UPDATE ... RETURNING).
  const invite = await consumeInvite(token);
  if (!invite) return sendJson(res, 400, { error: 'invalid_invite' });

  const user = await findByUsername(invite.intended_username);
  if (!user) return sendJson(res, 400, { error: 'invalid_invite' });

  const { rpID, expectedOrigin } = config();

  let consumed = null;
  const expectedChallenge = async (challenge) => {
    consumed = await consumeChallenge(challenge, 'registration');
    return Boolean(consumed) && consumed.user_id === user.id;
  };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
  } catch (err) {
    console.error('[t08] invite verify error:', err.message);
    return sendJson(res, 400, { error: 'registration_failed' });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return sendJson(res, 400, { error: 'registration_failed' });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await insert({
    userId: user.id,
    credentialId: credential.id,
    publicKeyBase64Url: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    deviceName,
  });

  await createSession(res, user.id);

  sendJson(res, 200, { ok: true });
});
