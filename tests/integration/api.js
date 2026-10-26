#!/usr/bin/env node
/**
 * TEST D'INTÉGRATION — API HTTP, comptes et droits (serveur lancé + base de données).
 *
 *   node tests/integration/api.js [--url http://localhost:3000]
 *
 * Variables : DATABASE_URL, SUPER_ADMIN_PSEUDO, SUPER_ADMIN_MOT_DE_PASSE (comme le serveur).
 * Crée un compte jetable « ci_xxxx », vérifie inscription / connexion / droits / blocage,
 * puis le supprime. Sortie 0 = tout est OK.
 */
require('dotenv').config({ quiet: true });
const assert = require('assert');
const prisma = require('../../src/db/prisma');
const DEMAIN = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

const i = process.argv.indexOf('--url');
const URL = (i > 0 ? process.argv[i + 1] : `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
let ok = 0;

async function req(methode, chemin, { corps, jeton } = {}) {
  const rep = await fetch(URL + chemin, {
    method: methode,
    headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let json = {};
  try { json = await rep.json(); } catch { /* vide */ }
  return { statut: rep.status, json, cookie: rep.headers.get('set-cookie') || '' };
}
function verifier(nom, condition, detail = '') {
  assert.ok(condition, `${nom} ${detail}`);
  ok++;
  console.log(`  ✓ ${nom}`);
}

(async () => {
  const pseudo = `ci_${Date.now().toString(36)}`;
  const mdp = 'mot-de-passe-ci-123';

  let r = await req('GET', '/api/sante');
  verifier('santé : le serveur répond avec une version', r.statut === 200 && r.json.ok && r.json.version, JSON.stringify(r.json));

  r = await req('POST', '/api/auth/inscription', { corps: { pseudo, motDePasse: mdp } });
  verifier('inscription', r.statut === 201 && r.json.joueur.rang === 'R1' && r.json.joueur.role === 'JOUEUR', JSON.stringify(r.json));
  verifier('cookie de session httpOnly', /HttpOnly/i.test(r.cookie), r.cookie);
  verifier('le mot de passe n\'est jamais renvoyé', !JSON.stringify(r.json).includes(mdp) && !('motDePasseHash' in r.json.joueur));

  const enBase = await prisma.joueur.findUnique({ where: { pseudo } });
  verifier('mot de passe chiffré en base (bcrypt)', enBase.motDePasseHash.startsWith('$2') && enBase.motDePasseHash !== mdp);

  r = await req('POST', '/api/auth/inscription', { corps: { pseudo: pseudo.toUpperCase(), motDePasse: mdp } });
  verifier('pseudo unique (insensible à la casse)', r.statut === 409, `statut ${r.statut}`);
  r = await req('POST', '/api/auth/inscription', { corps: { pseudo: `${pseudo}b`, motDePasse: '123' } });
  verifier('mot de passe trop court refusé', r.statut === 400, `statut ${r.statut}`);

  r = await req('POST', '/api/auth/connexion', { corps: { pseudo, motDePasse: 'faux-mot-de-passe' } });
  verifier('mauvais mot de passe refusé', r.statut === 401, `statut ${r.statut}`);
  r = await req('POST', '/api/auth/connexion', { corps: { pseudo, motDePasse: mdp } });
  verifier('connexion', r.statut === 200 && r.json.jeton, `statut ${r.statut}`);
  const jeton = r.json.jeton;

  r = await req('GET', '/api/auth/moi', { jeton });
  verifier('profil', r.statut === 200 && r.json.joueur.pseudo === pseudo);
  r = await req('GET', '/api/minijeux');
  verifier('API protégée sans connexion (401)', r.statut === 401);
  r = await req('GET', '/api/minijeux', { jeton });
  verifier('catalogue des 16 mini-jeux', r.statut === 200 && r.json.minijeux.length >= 16, `${r.json.minijeux?.length}`);

  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'VIP', dateObjet: DEMAIN, parametres: {} } });
  verifier('un R1 ne peut pas créer de partie (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('GET', '/api/admin/joueurs', { jeton });
  verifier('un R1 n\'a pas accès à l\'administration (403)', r.statut === 403, `statut ${r.statut}`);

  await prisma.joueur.update({ where: { pseudo }, data: { rang: 'R4' } });
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'VIP', dateObjet: DEMAIN, parametres: { nombreCible: 9 } } });
  verifier('paramètre invalide refusé (400)', r.statut === 400, `statut ${r.statut}`);
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', parametres: { nombreCible: 3 } } });
  verifier('objet de la partie obligatoire (400)', r.statut === 400, `statut ${r.statut}`);
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'PATRON', dateObjet: DEMAIN, parametres: { nombreCible: 3 } } });
  verifier('objet de la partie inconnu refusé (400)', r.statut === 400, `statut ${r.statut}`);
  r = await req('GET', '/api/designations', { jeton });
  verifier('désignations en cours', r.statut === 200 && 'CONDUCTEUR' in r.json.designations && 'VIP' in r.json.designations, JSON.stringify(r.json));
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'CONDUCTEUR', parametres: { nombreCible: 3 } } });
  verifier('date du Conducteur / VIP obligatoire (400)', r.statut === 400, `statut ${r.statut}`);
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'CONDUCTEUR', dateObjet: '2026-02-30', parametres: { nombreCible: 3 } } });
  verifier('date invalide refusée (400)', r.statut === 400, `statut ${r.statut}`);
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'CONDUCTEUR', dateObjet: DEMAIN, parametres: { nombreCible: 3 } } });
  verifier('un R4 crée une partie', r.statut === 201 && /^[A-Z0-9]{6}$/.test(r.json.code), JSON.stringify(r.json));
  r = await req('GET', '/api/admin/joueurs', { jeton });
  verifier('un R4 n\'a toujours pas accès à l\'administration (403)', r.statut === 403);

  // super admin
  r = await req('POST', '/api/auth/connexion', { corps: { pseudo: process.env.SUPER_ADMIN_PSEUDO, motDePasse: process.env.SUPER_ADMIN_MOT_DE_PASSE } });
  verifier('connexion du super admin', r.statut === 200 && r.json.joueur.role === 'SUPER_ADMIN', `statut ${r.statut}`);
  const admin = r.json.jeton;
  const id = enBase.id;
  r = await req('PATCH', `/api/admin/joueurs/${id}/rang`, { jeton: admin, corps: { rang: 'R2' } });
  verifier('changement de rang par le super admin', r.statut === 200 && r.json.joueur.rang === 'R2');
  r = await req('PATCH', `/api/admin/joueurs/${r.json.joueur.id}/rang`, { jeton, corps: { rang: 'R5' } });
  verifier('un joueur ne peut pas changer de rang lui-même (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('GET', '/api/admin/journaux', { jeton: admin });
  verifier('journal des actions', r.statut === 200 && r.json.journaux.some((j) => j.action === 'rang'));

  r = await req('PATCH', `/api/admin/joueurs/${id}/actif`, { jeton: admin, corps: { actif: false } });
  verifier('blocage du compte', r.statut === 200 && r.json.joueur.actif === false);
  r = await req('GET', '/api/auth/moi', { jeton });
  verifier('un compte bloqué perd l\'accès immédiatement', r.statut === 401, `statut ${r.statut}`);
  r = await req('POST', '/api/auth/connexion', { corps: { pseudo, motDePasse: mdp } });
  verifier('un compte bloqué ne peut plus se connecter', r.statut === 403, `statut ${r.statut}`);

  r = await req('DELETE', `/api/admin/joueurs/${id}`, { jeton: admin });
  verifier('suppression du compte de test', r.statut === 200);
  // nettoyage complet : la partie créée par le compte de test
  await prisma.partie.deleteMany({ where: { organisateurId: id } });
  await prisma.joueur.deleteMany({ where: { id } });

  console.log(`\n✅ API : ${ok} vérifications OK`);
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error(`\n❌ API : ÉCHEC — ${e.message}`);
  await prisma.$disconnect();
  process.exit(1);
});
