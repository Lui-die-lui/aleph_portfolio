'use strict';

const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const { requireSession } = require('../../_lib/session');
const { consumeChallenge } = require('../../_lib/challenge');
const { insert } = require('../../_lib/passkeys');
const { config } = require('../../_lib/webauthn');
const { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary } = require('../../_lib/http');

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const body = await readJsonBody(req);
  const response = body.response;
  const deviceName = typeof body.deviceName === 'string' && body.deviceName.trim()
    ? body.deviceName.trim().slice(0, 80)
    : '새 패스키';

  if (!response) return sendJson(res, 400, { error: 'missing_response' });

  const { rpID, expectedOrigin } = config();

  // Consumed exactly once here, whether or not verification below succeeds.
  // Also confirms the challenge was issued to *this* logged-in user, so one
  // account can't register a passkey against a challenge minted for another.
  let consumed = null;
  const expectedChallenge = async (challenge) => {
    consumed = await consumeChallenge(challenge, 'registration');
    return Boolean(consumed) && consumed.user_id === session.userId;
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
    console.error('[t08] registration verify error:', err.message);
    return sendJson(res, 400, { error: 'registration_failed' });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return sendJson(res, 400, { error: 'registration_failed' });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await insert({
    userId: session.userId,
    credentialId: credential.id,
    publicKeyBase64Url: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    deviceName,
  });

  sendJson(res, 200, { ok: true });
});
