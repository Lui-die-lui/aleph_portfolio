'use strict';

const { requireSession } = require('../session');
const { validateFields, updateOwned } = require('../privateItems');
const { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary } = require('../http');

// Reads the id from the URL path directly (not req.query/req.params) so
// this handler behaves identically under Vercel's Node runtime (reached
// via the vercel.json rewrite) and under the plain http.Server used for
// local dev + tests.
function idFromUrl(req) {
  const pathname = req.url.split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  return decodeURIComponent(segments[segments.length - 1] || '');
}

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const itemId = idFromUrl(req);
  if (!itemId) return sendJson(res, 400, { error: 'missing_id' });

  const body = await readJsonBody(req);
  const error = validateFields(body);
  if (error) return sendJson(res, 400, { error });

  // updateOwned matches "id = itemId AND user_id = session.userId" in one
  // statement — a request for another account's item, or a nonexistent
  // id, gets the same 404 either way.
  const item = await updateOwned(session.userId, itemId, body);
  if (!item) return sendJson(res, 404, { error: 'not_found' });

  sendJson(res, 200, { item });
});
