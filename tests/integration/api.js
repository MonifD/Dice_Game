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
  verifier('catalogue des mini-jeux (16 jeux rapides + Loup-Garou)', r.statut === 200 && r.json.minijeux.length >= 17, `${r.json.minijeux?.length}`);

  r = await req('GET', '/api/minijeux', { jeton });
  const lg = r.json.minijeux.find((m) => m.id === 'loup-garou');
  verifier('catégories de la page Jeux : Loup-Garou dans les jeux de soirée, « Pour s\'amuser » uniquement', r.json.categories?.length >= 2
    && r.json.minijeux.every((m) => m.categorie) && lg?.categorie === 'soiree' && JSON.stringify(lg.objets) === '["AMUSEMENT"]'
    && !r.json.bientot.some((b) => b.id === 'loup-garou'), JSON.stringify(lg));
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'VIP', dateObjet: DEMAIN, parametres: {} } });
  verifier('un membre simple ne peut pas lancer pour le VIP (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'CONDUCTEUR', dateObjet: DEMAIN, parametres: {} } });
  verifier('un membre simple ne peut pas lancer pour le Conducteur (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'AMUSEMENT', parametres: { nombreCible: 3 } } });
  verifier('un membre simple lance un jeu « Pour s\'amuser »', r.statut === 201, `statut ${r.statut} ${JSON.stringify(r.json)}`);
  const partieAmusement = await prisma.partie.findUnique({ where: { code: r.json.code } });
  verifier('« Pour s\'amuser » : pas de jour J', partieAmusement.objet === 'AMUSEMENT' && partieAmusement.dateObjet === null);
  r = await req('GET', '/api/admin/joueurs', { jeton });
  verifier('un R1 n\'a pas accès à l\'administration (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('PUT', '/api/designations', { jeton, corps: { objet: 'VIP', jour: DEMAIN, joueurId: null } });
  verifier('un membre simple ne modifie pas les désignations (403)', r.statut === 403, `statut ${r.statut}`);

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
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'CONDUCTEUR', dateObjet: '2020-01-01', parametres: { nombreCible: 3 } } });
  verifier('jour J dans le passé refusé (400)', r.statut === 400, `statut ${r.statut}`);
  r = await req('POST', '/api/salles', { jeton, corps: { miniJeu: 'des', objet: 'CONDUCTEUR', dateObjet: DEMAIN, parametres: { nombreCible: 3 } } });
  verifier('un R4 crée une partie', r.statut === 201 && /^[A-Z0-9]{6}$/.test(r.json.code), JSON.stringify(r.json));
  r = await req('GET', '/api/admin/joueurs', { jeton });
  verifier('un R4 voit les comptes (mot de passe temporaire, suppression)', r.statut === 200 && Array.isArray(r.json.joueurs), `statut ${r.statut}`);
  r = await req('GET', '/api/admin/questions', { jeton });
  verifier('un R4 (non admin) n\'a pas les questions du quiz (403)', r.statut === 403, `statut ${r.statut}`);

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

  // ---------------- rangs et rôles : R4 admin, R5 unique (passation)
  // les R5 déjà en base (base locale) sont remis à la fin : le test ne doit pas modifier de vrais comptes
  const r5Existants = await prisma.joueur.findMany({ where: { rang: 'R5', role: { not: 'SUPER_ADMIN' } }, select: { id: true } });
  const comptes = {};
  for (const suffixe of ['a', 'b', 'c']) {
    r = await req('POST', '/api/auth/inscription', { corps: { pseudo: `${pseudo}${suffixe}`, motDePasse: mdp } });
    comptes[suffixe] = { id: r.json.joueur.id, jeton: r.json.jeton };
  }
  const { a, b, c } = comptes;
  r = await req('PATCH', `/api/admin/joueurs/${a.id}/role`, { jeton: admin, corps: { role: 'ADMIN' } });
  verifier('un R1 ne peut pas être admin (400)', r.statut === 400, `statut ${r.statut}`);
  await req('PATCH', `/api/admin/joueurs/${a.id}/rang`, { jeton: admin, corps: { rang: 'R3' } });
  r = await req('PATCH', `/api/admin/joueurs/${a.id}/role`, { jeton: admin, corps: { role: 'ADMIN' } });
  verifier('le super admin nomme un admin R3', r.statut === 200 && r.json.joueur.role === 'ADMIN');
  r = await req('PATCH', `/api/admin/joueurs/${b.id}/role`, { jeton: a.jeton, corps: { role: 'ADMIN' } });
  verifier('un admin simple (R3) ne nomme pas d\'admin (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('PATCH', `/api/admin/joueurs/${b.id}/rang`, { jeton: a.jeton, corps: { rang: 'R5' } });
  verifier('un admin simple ne donne pas R5 (403)', r.statut === 403, `statut ${r.statut}`);
  await req('PATCH', `/api/admin/joueurs/${a.id}/rang`, { jeton: admin, corps: { rang: 'R4' } });
  await req('PATCH', `/api/admin/joueurs/${b.id}/rang`, { jeton: a.jeton, corps: { rang: 'R3' } });
  r = await req('PATCH', `/api/admin/joueurs/${b.id}/role`, { jeton: a.jeton, corps: { role: 'ADMIN' } });
  verifier('un R4 admin nomme un admin', r.statut === 200 && r.json.joueur.role === 'ADMIN', `statut ${r.statut}`);
  r = await req('PATCH', `/api/admin/joueurs/${b.id}/rang`, { jeton: a.jeton, corps: { rang: 'R2' } });
  verifier('un admin descendu R2 perd le rôle admin', r.statut === 200 && r.json.joueur.role === 'JOUEUR' && r.json.joueur.rang === 'R2', JSON.stringify(r.json));
  await req('PATCH', `/api/admin/joueurs/${b.id}/rang`, { jeton: a.jeton, corps: { rang: 'R3' } });
  await req('PATCH', `/api/admin/joueurs/${b.id}/role`, { jeton: a.jeton, corps: { role: 'ADMIN' } });
  r = await req('PATCH', `/api/admin/joueurs/${b.id}/role`, { jeton: a.jeton, corps: { role: 'JOUEUR' } });
  verifier('un R4 admin retire un admin', r.statut === 200 && r.json.joueur.role === 'JOUEUR', `statut ${r.statut}`);
  r = await req('PATCH', `/api/admin/joueurs/${b.id}/rang`, { jeton: a.jeton, corps: { rang: 'R5' } });
  verifier('un R4 admin ne donne pas R5 (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('GET', '/api/admin/journaux', { jeton: a.jeton });
  verifier('un R4 admin n\'a pas les journaux (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('PATCH', `/api/admin/joueurs/${b.id}/rang`, { jeton: admin, corps: { rang: 'R5' } });
  verifier('le super admin donne R5', r.statut === 200 && r.json.joueur.rang === 'R5', `statut ${r.statut}`);
  r = await req('GET', '/api/admin/journaux', { jeton: b.jeton });
  verifier('le R5 (non admin) a les droits du super admin : journaux', r.statut === 200, `statut ${r.statut}`);
  r = await req('PATCH', `/api/admin/joueurs/${a.id}/role`, { jeton: b.jeton, corps: { role: 'JOUEUR' } });
  verifier('le R5 retire un R4 admin', r.statut === 200 && r.json.joueur.role === 'JOUEUR', `statut ${r.statut}`);
  r = await req('PATCH', `/api/admin/joueurs/${b.id}/rang`, { jeton: a.jeton, corps: { rang: 'R1' } });
  verifier('personne sous le R5 ne peut le modifier (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('PATCH', `/api/admin/joueurs/${c.id}/rang`, { jeton: b.jeton, corps: { rang: 'R5' } });
  verifier('passation : le R5 donne R5', r.statut === 200 && r.json.joueur.rang === 'R5', `statut ${r.statut}`);
  const r5 = await prisma.joueur.findMany({ where: { rang: 'R5', role: { not: 'SUPER_ADMIN' } }, select: { id: true } });
  verifier('un seul R5 après la passation', r5.length === 1 && r5[0].id === c.id, JSON.stringify(r5));
  verifier('l\'ancien R5 redescend R4', (await prisma.joueur.findUnique({ where: { id: b.id } })).rang === 'R4');
  await prisma.joueur.deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } });
  if (r5Existants.length) await prisma.joueur.updateMany({ where: { id: { in: r5Existants.map((x) => x.id) } }, data: { rang: 'R5' } });

  // ---------------- désignations Conducteur / VIP (jour J), mot de passe temporaire, suppression
  const designations = require('../../src/services/designations');
  await prisma.joueur.update({ where: { id }, data: { rang: 'R4' } }); // le compte de test redevient R4 (non admin)
  const APRES = new Date(Date.now() + 5 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const membres = {};
  for (const suffixe of ['m', 'n', 'p']) {
    r = await req('POST', '/api/auth/inscription', { corps: { pseudo: `${pseudo}${suffixe}`, motDePasse: mdp } });
    membres[suffixe] = { id: r.json.joueur.id, jeton: r.json.jeton, pseudo: `${pseudo}${suffixe}` };
  }
  const { m, n, p } = membres;
  await designations.attribuerGagnant({ objet: 'CONDUCTEUR', jourJ: APRES, joueurId: m.id, partieId: null });
  await designations.attribuerGagnant({ objet: 'CONDUCTEUR', jourJ: APRES, joueurId: n.id, partieId: null });
  const lignes = await prisma.designation.findMany({ where: { objet: 'CONDUCTEUR', jour: new Date(`${APRES}T00:00:00Z`) }, orderBy: { id: 'asc' } });
  verifier('le gagnant de la dernière partie remplace le précédent (même rôle, même jour)',
    lignes.filter((l) => l.active).length === 1 && lignes.find((l) => l.active).joueurId === n.id, JSON.stringify(lignes));
  r = await req('GET', '/api/designations/historique', { jeton: m.jeton });
  const aVenir = r.json.aVenir.find((d) => d.objet === 'CONDUCTEUR' && d.jour === APRES);
  verifier('désignation à venir visible dans l\'historique', aVenir?.joueur?.id === n.id, JSON.stringify(r.json.aVenir));
  verifier('l\'ancienne désignation reste visible (« remplacé »)', r.json.journal.some((d) => d.joueur?.id === m.id && d.jour === APRES && d.statut === 'remplace'));
  r = await req('GET', '/api/designations', { jeton: m.jeton });
  verifier('une désignation future n\'apparaît pas dans les bandeaux du jour', r.json.designations.CONDUCTEUR?.joueur?.id !== n.id);
  r = await req('PUT', '/api/designations', { jeton, corps: { objet: 'CONDUCTEUR', jour: APRES, joueurId: p.id } });
  verifier('un R4 modifie la désignation à la main', r.statut === 200 && r.json.designation.joueur.id === p.id, JSON.stringify(r.json));
  r = await req('GET', '/api/designations/historique', { jeton: m.jeton });
  verifier('« modifié par … » sur la désignation remplacée à la main',
    r.json.journal.some((d) => d.joueur?.id === n.id && d.jour === APRES && d.statut === 'modifie' && d.modifiePar === pseudo), JSON.stringify(r.json.journal.slice(0, 3)));
  const modif = r.json.journal.find((d) => d.joueur?.id === p.id && d.jour === APRES);
  verifier('modification manuelle : ancien nom, nouveau nom, auteur, date', modif.mode === 'MANUELLE' && modif.ancienPseudo === n.pseudo && modif.auteur === pseudo && modif.date);

  // modifier le rôle d'une désignation existante : elle est déplacée (pas de doublon VIP + Conducteur)
  r = await req('PUT', '/api/designations', { jeton, corps: { objet: 'VIP', jour: APRES, joueurId: p.id, origine: { objet: 'CONDUCTEUR', jour: APRES, joueurId: p.id } } });
  verifier('changer le rôle d\'une désignation (Conducteur -> VIP)', r.statut === 200 && r.json.designation.objet === 'VIP', JSON.stringify(r.json));
  const actives = await prisma.designation.findMany({ where: { jour: new Date(`${APRES}T00:00:00Z`), active: true } });
  verifier('l\'ancienne désignation est retirée, pas de doublon', actives.filter((d) => d.joueurId === p.id).length === 1
    && actives.find((d) => d.objet === 'CONDUCTEUR')?.joueurId == null, JSON.stringify(actives));
  r = await req('GET', '/api/designations/historique', { jeton: m.jeton });
  verifier('désignations à venir : pas de case « Non désigné » laissée par le déplacement', !r.json.aVenir.some((d) => d.objet === 'CONDUCTEUR' && d.jour === APRES));
  verifier('historique : le déplacement est relié (« déplacé vers / depuis »)', r.json.journal.some((d) => d.deplacement?.sens === 'vers' && d.objet === 'CONDUCTEUR')
    && r.json.journal.some((d) => d.deplacement?.sens === 'depuis' && d.objet === 'VIP' && d.joueur?.id === p.id));
  r = await req('PUT', '/api/designations', { jeton, corps: { objet: 'CONDUCTEUR', jour: APRES, joueurId: p.id, origine: { objet: 'VIP', jour: APRES, joueurId: p.id } } });
  verifier('et dans l\'autre sens (VIP -> Conducteur)', r.statut === 200 && r.json.designation.objet === 'CONDUCTEUR', JSON.stringify(r.json));

  // mot de passe temporaire
  r = await req('POST', `/api/admin/joueurs/${p.id}/mot-de-passe`, { jeton, corps: { motDePasse: 'temporaire-123' } });
  verifier('un R4 donne un mot de passe temporaire à un membre', r.statut === 200, `statut ${r.statut}`);
  r = await req('POST', '/api/auth/connexion', { corps: { pseudo: p.pseudo, motDePasse: 'temporaire-123' } });
  verifier('connexion avec le mot de passe temporaire', r.statut === 200 && r.json.joueur.doitChangerMdp === true, JSON.stringify(r.json.joueur));
  const jetonP = r.json.jeton;
  r = await req('GET', '/api/salles', { jeton: jetonP });
  verifier('le reste du site est bloqué tant qu\'il n\'est pas changé (403 changer_mdp)', r.statut === 403 && r.json.code === 'changer_mdp', `statut ${r.statut}`);
  r = await req('POST', '/api/auth/mot-de-passe', { jeton: jetonP, corps: { nouveau: 'temporaire-123' } });
  verifier('le nouveau mot de passe doit être différent', r.statut === 400, `statut ${r.statut}`);
  r = await req('POST', '/api/auth/mot-de-passe', { jeton: jetonP, corps: { nouveau: 'mon-nouveau-123' } });
  verifier('le membre choisit son nouveau mot de passe', r.statut === 200, `statut ${r.statut}`);
  r = await req('GET', '/api/salles', { jeton: jetonP });
  verifier('accès rétabli après le changement', r.statut === 200, `statut ${r.statut}`);

  // droits : un R4 ne touche ni un R5 ni un admin ; personne ne supprime son propre compte
  await prisma.joueur.update({ where: { id: m.id }, data: { rang: 'R5' } });
  r = await req('POST', `/api/admin/joueurs/${m.id}/mot-de-passe`, { jeton, corps: { motDePasse: 'temporaire-123' } });
  verifier('un R4 ne modifie pas le mot de passe d\'un R5 (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('DELETE', `/api/admin/joueurs/${m.id}`, { jeton });
  verifier('un R4 ne supprime pas un R5 (403)', r.statut === 403, `statut ${r.statut}`);
  await prisma.joueur.update({ where: { id: m.id }, data: { rang: 'R3', role: 'ADMIN' } });
  await prisma.joueur.update({ where: { id: n.id }, data: { rang: 'R5' } });
  r = await req('DELETE', `/api/admin/joueurs/${m.id}`, { jeton: n.jeton });
  verifier('un R5 ne supprime pas un admin (403)', r.statut === 403, `statut ${r.statut}`);
  r = await req('DELETE', `/api/admin/joueurs/${n.id}`, { jeton: n.jeton });
  verifier('personne ne supprime son propre compte (403)', r.statut === 403, `statut ${r.statut}`);
  await prisma.joueur.update({ where: { id: m.id }, data: { rang: 'R1', role: 'JOUEUR' } });
  await prisma.joueur.update({ where: { id: n.id }, data: { rang: 'R1' } });

  // suppression : désignation à venir -> « Non désigné », parties gardées avec « (compte supprimé) »
  await prisma.partie.update({ where: { id: partieAmusement.id }, data: { statut: 'TERMINEE', gagnantId: p.id, dateFin: new Date() } });
  r = await req('DELETE', `/api/admin/joueurs/${p.id}`, { jeton });
  verifier('un R4 supprime le compte d\'un membre', r.statut === 200 && r.json.designationsRetirees === 1, JSON.stringify(r.json));
  r = await req('GET', '/api/designations/historique', { jeton: m.jeton });
  verifier('sa désignation à venir passe à « Non désigné »', r.json.aVenir.some((d) => d.objet === 'CONDUCTEUR' && d.jour === APRES && d.joueur === null && d.mode === 'SUPPRESSION'));
  r = await req('GET', '/api/historique?objet=AMUSEMENT', { jeton: m.jeton });
  verifier('ses parties restent avec « (compte supprimé) »', r.json.parties.some((x) => x.id === partieAmusement.id && x.gagnant.pseudo === `${p.pseudo} (compte supprimé)`), JSON.stringify(r.json.parties[0]));
  r = await req('POST', '/api/auth/connexion', { corps: { pseudo: p.pseudo, motDePasse: 'mon-nouveau-123' } });
  verifier('un compte supprimé ne peut plus se connecter', r.statut === 401, `statut ${r.statut}`);
  r = await req('GET', '/api/admin/journaux', { jeton: admin });
  verifier('journal : mot de passe temporaire, suppression, désignation modifiée',
    ['mot_de_passe_temporaire', 'supprimer', 'designation_modifiee'].every((a) => r.json.journaux.some((j) => j.action === a)));
  await prisma.designation.deleteMany({ where: { jour: new Date(`${APRES}T00:00:00Z`), OR: [{ joueurId: { in: [m.id, n.id, p.id] } }, { joueurId: null }] } });
  await prisma.partie.deleteMany({ where: { id: partieAmusement.id } });
  await prisma.joueur.deleteMany({ where: { id: { in: [m.id, n.id, p.id] } } });

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
