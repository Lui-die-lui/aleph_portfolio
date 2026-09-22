'use strict';

const { requireSession } = require('../_lib/session');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../_lib/http');

// Never trusts a client-supplied identifier — the only input is the
// HttpOnly session cookie itself.
module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { authenticated: false });

  sendJson(res, 200, {
    authenticated: true,
    displayName: session.displayName,
  });
});
