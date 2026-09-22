'use strict';

const { generateRegistrationOptions } = require('@simplewebauthn/server');
const { recordChallenge } = require('../../_lib/challenge');
const { peekInvite } = require('../../_lib/invites');
const { upsertByUsername, passkeyCount } = require('../../_lib/users');
const { config } = require('../../_lib/webauthn');
const { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary } = require('../../_lib/http');

// Creates an additional account (e.g. the isolation-test account) from a
// short-lived, single-use invite token minted locally with
// `npm run t08:create-invite`. No password/email is ever collected — the
// token itself, never persisted in plaintext, is the only gate.
module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const body = await readJsonBody(req);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) return sendJson(res, 400, { error: 'missing_token' });

  const invite = await peekInvite(token);
  if (!invite) return sendJson(res, 400, { error: 'invalid_invite' });

  const userId = await upsertByUsername(invite.intended_username, invite.intended_display_name);
  const n = await passkeyCount(userId);
  if (n > 0) {
    return sendJson(res, 409, { error: 'already_registered' });
  }

  const { rpID, rpName } = config();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: invite.intended_username,
    userID: Buffer.from(userId, 'utf8'),
    userDisplayName: invite.intended_display_name,
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
