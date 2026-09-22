'use strict';

const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const { consumeChallenge } = require('../../_lib/challenge');
const { insert, listByUser } = require('../../_lib/passkeys');
const { findByUsername } = require('../../_lib/users');
const { createSession } = require('../../_lib/session');
const { config } = require('../../_lib/webauthn');
const { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary } = require('../../_lib/http');

const OWNER_USERNAME = 'owner';

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  if (process.env.T08_BOOTSTRAP_ENABLED !== 'true') {
    return sendJson(res, 403, { error: 'bootstrap_disabled' });
  }

  const owner = await findByUsername(OWNER_USERNAME);
  if (!owner) return sendJson(res, 400, { error: 'bootstrap_not_started' });

  const existing = await listByUser(owner.id);
  if (existing.length > 0) {
    return sendJson(res, 403, { error: 'bootstrap_already_used' });
  }

  const body = await readJsonBody(req);
  const response = body.response;
  const deviceName =
    typeof body.deviceName === 'string' && body.deviceName.trim()
      ? body.deviceName.trim().slice(0, 80)
      : '첫 패스키';

  if (!response) return sendJson(res, 400, { error: 'missing_response' });

  const { rpID, expectedOrigin } = config();

  let consumed = null;
  const expectedChallenge = async (challenge) => {
    consumed = await consumeChallenge(challenge, 'registration');
    return Boolean(consumed) && consumed.user_id === owner.id;
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
    console.error('[t08] bootstrap verify error:', err.message);
    return sendJson(res, 400, { error: 'registration_failed' });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return sendJson(res, 400, { error: 'registration_failed' });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await insert({
    userId: owner.id,
    credentialId: credential.id,
    publicKeyBase64Url: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    deviceName,
  });

  await createSession(res, owner.id);

  sendJson(res, 200, { ok: true });
});
