'use strict';

const { requireSession } = require('../session');
const { deleteOwned } = require('../privateItems');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../http');

function idFromUrl(req) {
  const pathname = req.url.split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  return decodeURIComponent(segments[segments.length - 1] || '');
}

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const itemId = idFromUrl(req);
  if (!itemId) return sendJson(res, 400, { error: 'missing_id' });

  // deleteOwned matches "id = itemId AND user_id = session.userId" — same
  // 404 whether the item doesn't exist or belongs to someone else.
  const deleted = await deleteOwned(session.userId, itemId);
  if (!deleted) return sendJson(res, 404, { error: 'not_found' });

  sendJson(res, 200, { ok: true });
});
