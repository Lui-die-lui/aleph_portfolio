'use strict';

const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { consumeChallenge } = require('../challenge');
const { findByCredentialId, touchAfterLogin } = require('../passkeys');
const { createSession } = require('../session');
const { config } = require('../webauthn');
const { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary } = require('../http');

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const body = await readJsonBody(req);
  const response = body.response;
  if (!response || !response.id || !response.response) {
    return sendJson(res, 400, { error: 'missing_response' });
  }

  const { rpID, expectedOrigin } = config();
  const passkey = await findByCredentialId(response.id);

  let consumed = null;
  const expectedChallenge = async (challenge) => {
    consumed = await consumeChallenge(challenge, 'authentication');
    return Boolean(consumed);
  };

  if (!passkey) {
    // No matching credential — still burn the challenge from this response
    // so it can't be retried against a different (real) credential id.
    try {
      const clientData = JSON.parse(
        Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')
      );
      await expectedChallenge(clientData.challenge);
    } catch (_) {
      // malformed client data — nothing valid to consume
    }
    return sendJson(res, 401, { error: 'authentication_failed' });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64url')),
        counter: Number(passkey.counter),
        transports: passkey.transports ? passkey.transports.split(',') : undefined,
      },
    });
  } catch (err) {
    console.error('[t08] auth verify error:', err.message);
    return sendJson(res, 401, { error: 'authentication_failed' });
  }

  if (!verification.verified) {
    return sendJson(res, 401, { error: 'authentication_failed' });
  }

  await touchAfterLogin(passkey.credential_id, verification.authenticationInfo.newCounter);
  await createSession(res, passkey.user_id);

  sendJson(res, 200, { ok: true });
});
