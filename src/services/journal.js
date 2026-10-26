/** Journal des actions sensibles (rangs, blocages, suppressions…), visible par le super admin. */
const prisma = require('../db/prisma');

async function journaliser(auteurId, action, details = null) {
  try {
    await prisma.journal.create({ data: { auteurId: auteurId ? Number(auteurId) : null, action, details } });
  } catch (e) { console.error('[journal]', e.message); }
}

module.exports = { journaliser };
