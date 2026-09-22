'use strict';

const { readSessionCookie, revokeSession } = require('../_lib/session');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../_lib/http');

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const rawToken = readSessionCookie(req);
  await revokeSession(res, rawToken);

  sendJson(res, 200, { ok: true });
});
