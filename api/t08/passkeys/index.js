'use strict';

const { requireSession } = require('../_lib/session');
const { listByUser } = require('../_lib/passkeys');
const { sendJson, methodNotAllowed, withErrorBoundary } = require('../_lib/http');

// Masks credential_id (front/back only) — it isn't secret, but the
// submission doc convention (and this UI) avoids printing it in full.
function mask(value) {
  if (!value || value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

module.exports = withErrorBoundary(async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const session = await requireSession(req);
  if (!session) return sendJson(res, 401, { error: 'not_authenticated' });

  const rows = await listByUser(session.userId);
  const passkeys = rows.map((row) => ({
    id: row.id,
    credentialIdMasked: mask(row.credential_id),
    deviceName: row.device_name,
    deviceType: row.device_type,
    backedUp: row.backed_up,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));

  sendJson(res, 200, { passkeys });
});
