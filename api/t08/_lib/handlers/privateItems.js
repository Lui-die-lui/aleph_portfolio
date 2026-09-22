'use strict';

const { requireSession } = require('../session');
const { query } = require('../db');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../http');

// Ownership is always derived from the session, never from a query string
// or request body. A ?userId=... on this route is ignored entirely.
module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const result = await query(
    `select id, title, content, category, created_at, updated_at
       from t08_private_items
      where user_id = $1
      order by created_at asc`,
    [session.userId]
  );

  sendJson(res, 200, { items: result.rows });
});
