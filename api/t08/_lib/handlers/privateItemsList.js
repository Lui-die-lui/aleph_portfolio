'use strict';

const { requireSession } = require('../session');
const { listByUser } = require('../privateItems');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../http');

// Ownership is always derived from the session, never from a query string
// or request body. A ?userId=... on this route is ignored entirely.
module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const items = await listByUser(session.userId);
  sendJson(res, 200, { items });
});
