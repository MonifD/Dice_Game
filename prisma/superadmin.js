/**
 * Applique le super admin défini dans .env :   npm run superadmin
 *
 *  - crée le compte SUPER_ADMIN_PSEUDO s'il n'existe pas, sinon met à jour son mot de passe
 *    avec SUPER_ADMIN_MOT_DE_PASSE, le passe super admin / R5 et le débloque ;
 *  - les AUTRES comptes super admin (ex. ancien pseudo) redeviennent de simples joueurs et sont bloqués,
 *    pour qu'il n'y ait qu'un seul super admin.
 *
 * À lancer après avoir changé le pseudo ou le mot de passe du super admin dans .env
 * (serveur arrêté ou non, peu importe). Fonctionne aussi contre la base de production.
 */
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const prisma = require('../src/db/prisma');
const { normaliserPseudo, validerMotDePasse, COUT_BCRYPT } = require('../src/services/authService');

(async () => {
  const pseudo = String(process.env.SUPER_ADMIN_PSEUDO || '').trim().replace(/\s+/g, ' ');
  const mdp = process.env.SUPER_ADMIN_MOT_DE_PASSE || '';
  if (!pseudo) throw new Error('SUPER_ADMIN_PSEUDO est vide dans .env');
  if (pseudo.length < 2 || pseudo.length > 24) throw new Error('SUPER_ADMIN_PSEUDO doit faire entre 2 et 24 caractères.');
  validerMotDePasse(mdp);

  const pn = normaliserPseudo(pseudo);
  const motDePasseHash = await bcrypt.hash(mdp, COUT_BCRYPT);
  const existant = await prisma.joueur.findUnique({ where: { pseudoNormalise: pn } });
  const sa = existant
    ? await prisma.joueur.update({
      where: { id: existant.id },
      data: { pseudo, motDePasseHash, role: 'SUPER_ADMIN', rang: 'R5', actif: true },
    })
    : await prisma.joueur.create({
      data: { pseudo, pseudoNormalise: pn, motDePasseHash, role: 'SUPER_ADMIN', rang: 'R5' },
    });
  console.log(`✅ Super admin « ${sa.pseudo} » ${existant ? 'mis à jour (nouveau mot de passe)' : 'créé'}.`);

  const autres = await prisma.joueur.findMany({ where: { role: 'SUPER_ADMIN', id: { not: sa.id } } });
  for (const a of autres) {
    await prisma.joueur.update({ where: { id: a.id }, data: { role: 'JOUEUR', rang: 'R1', actif: false } });
    console.log(`🔒 Ancien super admin « ${a.pseudo} » retiré et bloqué (supprimable depuis Administration → Comptes).`);
  }
  await prisma.journal.create({ data: { auteurId: sa.id, action: 'superadmin_env', details: { pseudo: sa.pseudo, anciens: autres.map((a) => a.pseudo) } } });
  console.log('Tu peux te connecter. (Si le serveur tourne, inutile de le redémarrer.)');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('❌', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
