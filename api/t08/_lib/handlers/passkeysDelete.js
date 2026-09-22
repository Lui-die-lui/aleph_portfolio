'use strict';

const { requireSession } = require('../session');
const { deleteOwned } = require('../passkeys');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../http');

// Reads the id from the URL path directly (not req.query/req.params) so
// this handler behaves identically under Vercel's Node runtime and under
// the plain http.Server used for local dev + tests.
function idFromUrl(req) {
  const pathname = req.url.split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  return decodeURIComponent(segments[segments.length - 1] || '');
}

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const passkeyId = idFromUrl(req);
  if (!passkeyId) return sendJson(res, 400, { error: 'missing_id' });

  // Ownership (user_id = session.userId) and the "keep at least one" rule
  // are both enforced inside deleteOwned in a single transaction — never
  // trusting anything about ownership from the request itself.
  const outcome = await deleteOwned(session.userId, passkeyId);

  if (outcome === 'last_remaining') {
    return sendJson(res, 409, { error: 'last_passkey' });
  }
  if (outcome === 'not_found') {
    // Also covers "exists but belongs to someone else" — same 404 either
    // way so existence of other accounts' passkeys isn't revealed.
    return sendJson(res, 404, { error: 'not_found' });
  }

  sendJson(res, 200, { ok: true });
});
