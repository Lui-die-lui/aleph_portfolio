'use strict';

const { requireSession } = require('../session');
const { validateFields, insert } = require('../privateItems');
const { readJsonBody, sendJson, methodNotAllowed, withErrorBoundary } = require('../http');

// The item's owner is always session.userId — never a userId/ownerId the
// client might send in the body.
module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const body = await readJsonBody(req);
  const error = validateFields(body);
  if (error) return sendJson(res, 400, { error });

  const item = await insert(session.userId, body);
  sendJson(res, 201, { item });
});
