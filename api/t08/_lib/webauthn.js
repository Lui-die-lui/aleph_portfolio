'use strict';

// Central place for RP config so every route agrees on rpID/rpName/origin.
// expectedOrigin is a literal allow-list (never a wildcard) so a Vercel
// preview URL or an attacker-controlled Origin header can't slip through.
function config() {
  const rpID = process.env.T08_RP_ID;
  const rpName = process.env.T08_RP_NAME;
  const originsRaw = process.env.T08_EXPECTED_ORIGIN;
  if (!rpID || !rpName || !originsRaw) {
    throw new Error('T08_RP_ID, T08_RP_NAME and T08_EXPECTED_ORIGIN must all be set');
  }
  const expectedOrigin = originsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { rpID, rpName, expectedOrigin };
}

module.exports = { config };
