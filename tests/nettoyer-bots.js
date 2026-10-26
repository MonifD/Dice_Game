#!/usr/bin/env node
/**
 * Supprime tout ce que le test de charge a créé : comptes Bot001…, BotOrganisateur
 * et les parties qu'il a organisées (avec leurs participations).
 *   node tests/nettoyer-bots.js
 * Utilise DATABASE_URL (variable d'environnement ou .env).
 */
require('dotenv').config({ quiet: true });
const prisma = require('../src/db/prisma');

(async () => {
  const org = await prisma.joueur.findUnique({ where: { pseudoNormalise: 'botorganisateur' } });
  let parties = { count: 0 };
  if (org) parties = await prisma.partie.deleteMany({ where: { organisateurId: org.id } });
  // les bots ne peuvent avoir gagné que des parties du BotOrganisateur ; par sécurité on détache les autres
  const bots = await prisma.joueur.findMany({ where: { pseudoNormalise: { startsWith: 'bot' } }, select: { id: true, pseudo: true } });
  const ids = bots.filter((b) => /^Bot(\d{3}|Organisateur)$/.test(b.pseudo)).map((b) => b.id);
  await prisma.partie.updateMany({ where: { gagnantId: { in: ids } }, data: { gagnantId: null } });
  const comptes = await prisma.joueur.deleteMany({ where: { id: { in: ids } } });
  console.log(`🧹 ${parties.count} partie(s) de test et ${comptes.count} compte(s) bot supprimés.`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('❌', e.message); await prisma.$disconnect(); process.exit(1); });
