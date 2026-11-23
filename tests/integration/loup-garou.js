#!/usr/bin/env node
/**
 * TEST D'INTÉGRATION — une partie complète de Loup-Garou avec des joueurs simulés (serveur lancé + base).
 *
 *   node tests/integration/loup-garou.js [--url http://localhost:3000] [--joueurs 7]
 *
 * Vérifie : lancement par un membre simple (« Pour s'amuser »), minimum de joueurs, rôles secrets
 * (rien dans la vue publique ni dans les messages des autres), droits des chats (loups, cimetière, nuit),
 * déroulé jusqu'à la fin, enregistrement du camp gagnant. Les comptes « lg_xxx » sont supprimés à la fin.
 */
require('dotenv').config({ quiet: true });
const assert = require('assert');
const { io } = require('socket.io-client');
const prisma = require('../../src/db/prisma');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, t) => {
  if (a.startsWith('--')) acc.push([a.slice(2), t[i + 1] && !t[i + 1].startsWith('--') ? t[i + 1] : true]);
  return acc;
}, []));
const URL = (args.url || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const N = parseInt(args.joueurs || '7', 10);
const PATH = process.env.SOCKET_PATH || '/api/socket.io';
let ok = 0;
const verifier = (nom, cond, detail = '') => { assert.ok(cond, `${nom} ${detail}`); ok++; console.log(`  ✓ ${nom}`); };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(chemin, corps, jeton) {
  const r = await fetch(URL + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: JSON.stringify(corps) });
  return { statut: r.status, json: await r.json().catch(() => ({})) };
}
const connecter = (jeton) => new Promise((resolve, reject) => {
  const s = io(URL, { path: PATH, transports: ['websocket'], auth: { token: jeton } });
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
});
const emettre = (s, ev, d = {}) => new Promise((r) => s.timeout(8000).emit(ev, d, (err, rep) => r(err ? { ok: false, erreur: 'timeout' } : rep)));

(async () => {
  const suffixe = Date.now().toString(36);
  const joueurs = [];
  for (let i = 0; i < N + 1; i++) { // N joueurs + 1 spectateur
    const pseudo = `lg_${suffixe}_${i}`;
    const r = await post('/api/auth/inscription', { pseudo, motDePasse: 'mdp-loup-123' });
    assert.strictEqual(r.statut, 201, JSON.stringify(r.json));
    joueurs.push({ id: String(r.json.joueur.id), pseudo, jeton: r.json.jeton });
  }
  const spectateur = joueurs.pop();
  const [orga] = joueurs;

  let r = await post('/api/salles', { miniJeu: 'loup-garou', objet: 'VIP', dateObjet: new Date().toISOString().slice(0, 10), parametres: {} }, orga.jeton);
  verifier('Loup-Garou : jamais pour le Conducteur / VIP', r.statut === 400 || r.statut === 403, `statut ${r.statut}`);
  r = await post('/api/salles', { miniJeu: 'loup-garou', objet: 'AMUSEMENT', parametres: { dureeNuit: 15, dureeDebat: 30, dureeVote: 20 } }, orga.jeton);
  verifier('un membre simple lance un Loup-Garou « Pour s\'amuser »', r.statut === 201, JSON.stringify(r.json));
  const { code } = r.json;

  // connexions + écoute de tout ce que chaque joueur reçoit (pour l'anti-triche)
  for (const j of [...joueurs, spectateur]) {
    j.socket = await connecter(j.jeton);
    j.recu = [];
    j.prive = null;
    j.socket.onAny((ev, d) => j.recu.push([ev, d]));
    j.socket.on('jeu:prive', (p) => { if (p.code === code) j.prive = p.vue; });
    j.socket.on('salle:etat', (e) => { if (e.code === code) j.etat = e; });
    const obs = await emettre(j.socket, 'salle:observer', { code });
    j.etat = obs.etat;
  }
  for (const j of joueurs.slice(0, 5)) { await emettre(j.socket, 'salle:inscrire', { code }); await emettre(j.socket, 'salle:pret', { code, pret: true }); }
  r = await emettre(orga.socket, 'salle:lancer', { code });
  verifier('impossible de lancer à moins de 6 joueurs', !r.ok && /6/.test(r.erreur), r.erreur);
  for (const j of joueurs.slice(5)) { await emettre(j.socket, 'salle:inscrire', { code }); await emettre(j.socket, 'salle:pret', { code, pret: true }); }
  r = await emettre(joueurs[1].socket, 'salle:lancer', { code });
  verifier('un autre membre ne peut pas lancer la salle de quelqu\'un d\'autre', !r.ok);
  r = await emettre(orga.socket, 'salle:lancer', { code });
  verifier('l\'organisateur (membre simple) lance la partie', r.ok, r.erreur);
  await attendre(500);

  const roles = Object.fromEntries(joueurs.map((j) => [j.id, j.prive?.role?.id]));
  verifier('chaque joueur reçoit sa carte', joueurs.every((j) => j.prive?.role?.id), JSON.stringify(roles));
  verifier('le spectateur ne reçoit aucune carte', spectateur.prive === null);
  const loups = joueurs.filter((j) => roles[j.id] === 'LOUP');
  const villageois = joueurs.filter((j) => roles[j.id] !== 'LOUP');
  verifier(`${N} joueurs : 2 loups`, loups.length === 2);
  verifier('les loups se connaissent', loups.every((l) => l.prive.loups.length === 2));
  verifier('un villageois ne voit pas les loups', villageois.every((v) => v.prive.loups === null));
  verifier('aucun rôle dans la vue publique', orga.etat.vue.joueurs.every((j) => j.role === null));

  // reconnexion : on retrouve son rôle
  const revenant = villageois[1];
  revenant.socket.close();
  revenant.socket = await connecter(revenant.jeton);
  r = await emettre(revenant.socket, 'salle:observer', { code });
  verifier('après une reconnexion, le joueur retrouve son rôle et la partie', r.ok && r.prive?.role?.id === roles[revenant.id] && r.etat.phase === 'jeu');
  revenant.socket.on('jeu:prive', (p) => { if (p.code === code) revenant.prive = p.vue; });
  revenant.socket.on('salle:etat', (e) => { if (e.code === code) revenant.etat = e; });
  revenant.socket.onAny((ev, d) => revenant.recu.push([ev, d]));

  // exclusion d'un absent (le dernier villageois se déconnecte)
  const absent = villageois[villageois.length - 1];
  r = await emettre(orga.socket, 'salle:exclure', { code, joueurId: absent.id });
  verifier('on ne peut pas exclure un joueur connecté', !r.ok && /connecté/.test(r.erreur), r.erreur);
  absent.socket.close();
  await attendre(300);
  r = await emettre(joueurs.find((j) => j !== orga && j !== absent).socket, 'salle:exclure', { code, joueurId: absent.id });
  verifier('un autre membre ne peut pas exclure', !r.ok);
  r = await emettre(orga.socket, 'salle:exclure', { code, joueurId: absent.id });
  verifier('l\'organisateur exclut un joueur absent', r.ok, r.erreur);
  await attendre(300);
  const exclu = orga.etat.vue.joueurs.find((j) => j.id === absent.id);
  verifier('le joueur exclu est mort et son rôle est révélé', !exclu.vivant && exclu.role === roles[absent.id] && exclu.mort.cause === 'exclu', JSON.stringify(exclu));
  joueurs.splice(joueurs.indexOf(absent), 1);
  villageois.splice(villageois.indexOf(absent), 1);

  // chats
  r = await emettre(villageois[0].socket, 'chat:rejoindre', { canal: `jeu:${code}:loups` });
  verifier('un villageois ne peut pas lire le salon des loups', !r.ok, JSON.stringify(r));
  r = await emettre(loups[0].socket, 'chat:rejoindre', { canal: `jeu:${code}:loups` });
  verifier('un loup lit le salon des loups', r.ok, r.erreur);
  r = await emettre(loups[0].socket, 'chat:envoyer', { canal: `jeu:${code}:loups`, texte: 'on mange qui ?' });
  verifier('un loup écrit dans le salon des loups', r.ok, r.erreur);
  r = await emettre(villageois[0].socket, 'chat:rejoindre', { canal: `jeu:${code}:morts` });
  verifier('un vivant ne voit pas le Cimetière', !r.ok);
  r = await emettre(spectateur.socket, 'chat:rejoindre', { canal: `jeu:${code}:morts` });
  verifier('le spectateur lit le Cimetière', r.ok, r.erreur);
  r = await emettre(villageois[0].socket, 'chat:envoyer', { canal: `salle:${code}`, texte: 'coucou' });
  verifier('chat du village fermé la nuit', !r.ok && /nuit/.test(r.erreur), r.erreur);
  r = await emettre(villageois[0].socket, 'jeu:action', { code, donnees: { cible: loups[0].id } });
  verifier('action refusée hors de son tour', !r.ok, JSON.stringify(r));

  // ---- jeu automatique : chaque joueur agit dès qu'il le peut
  const debut = Date.now();
  let actions = 0;
  let debatPasse = false;
  let verifieMort = false;
  while (Date.now() - debut < 240000) {
    const etat = orga.etat;
    if (etat.phase === 'termine') break;
    for (const j of joueurs) {
      const a = j.prive?.action;
      if (!a || a.fait) continue;
      const vivants = a.cibles || [];
      const pick = (liste) => liste[0];
      let d = null;
      if (a.type === 'cupidon') d = { cibles: vivants.slice(0, 2) };
      else if (a.type === 'loups') d = a.choix ? null : { cible: pick(vivants) };
      else if (a.type === 'vote') {
        if (!a.choix) d = { cible: roles[j.id] === 'LOUP' ? pick(vivants.filter((x) => roles[x] !== 'LOUP')) || pick(vivants) : pick(vivants.filter((x) => roles[x] === 'LOUP')) || pick(vivants) };
      } else if (a.type === 'sorciere') d = { terminer: true };
      else if (vivants.length) d = { cible: pick(vivants) };
      if (d) { const rep = await emettre(j.socket, 'jeu:action', { code, donnees: d }); if (rep.ok) actions++; }
    }
    if (etat.vue?.phase === 'debat' && !debatPasse) {
      const rep = await emettre(orga.socket, 'salle:suivant', { code });
      verifier('l\'organisateur peut passer le débat', rep.ok, rep.erreur);
      debatPasse = true;
    }
    // un mort ne parle plus au village et rejoint le Cimetière
    const mort = joueurs.find((j) => j.prive && !j.prive.vivant);
    if (mort && !verifieMort && etat.vue?.phase === 'debat') {
      verifieMort = true;
      const rep = await emettre(mort.socket, 'chat:envoyer', { canal: `salle:${code}`, texte: 'je suis mort' });
      verifier('un mort ne peut pas écrire aux vivants', !rep.ok, JSON.stringify(rep));
      const rep2 = await emettre(mort.socket, 'chat:rejoindre', { canal: `jeu:${code}:morts` });
      verifier('un mort rejoint le Cimetière', rep2.ok, rep2.erreur);
    }
    await attendre(300);
  }
  verifier('la partie va jusqu\'au bout', orga.etat.phase === 'termine', `phase ${orga.etat.phase} / ${orga.etat.vue?.phase}`);
  verifier('des actions ont été jouées', actions > 3, `${actions}`);
  const fin = orga.etat.vue.fin;
  verifier('écran de fin : camp gagnant, tous les rôles, résumé', fin && fin.roles.length === N && Array.isArray(fin.resume), JSON.stringify(fin).slice(0, 200));
  console.log(`    -> ${fin.libelle} (${fin.gagnants.length} gagnant(s)), ${fin.resume.length} mort(s), ${Math.round((Date.now() - debut) / 1000)} s`);

  // anti-triche : avant la fin, aucun message reçu par un villageois ne contenait le rôle d'un vivant
  const v0 = villageois[0];
  const avantFin = v0.recu.filter(([ev, d]) => ev === 'salle:etat' && d.phase === 'jeu');
  const fuite = avantFin.some(([, d]) => d.vue.joueurs.some((j) => j.vivant && j.role));
  verifier('anti-triche : aucun rôle de joueur vivant dans les messages publics', avantFin.length > 3 && !fuite, `${avantFin.length} états`);
  const prives = v0.recu.filter(([ev]) => ev === 'jeu:prive').map(([, d]) => d.vue);
  verifier('anti-triche : un villageois ne reçoit jamais la meute', prives.every((p) => p.loups === null));
  verifier('anti-triche : les vues privées des autres ne lui parviennent pas', v0.recu.filter(([ev]) => ev === 'jeu:prive').every(([, d]) => d.vue.role.id === roles[v0.id]));

  const partie = await prisma.partie.findUnique({ where: { code } });
  verifier('historique : partie enregistrée avec le camp gagnant et les gagnants', partie.statut === 'TERMINEE' && partie.objet === 'AMUSEMENT'
    && partie.resultat?.camp === fin.camp && partie.resultat.gagnants.length === fin.gagnants.length, JSON.stringify(partie.resultat));

  for (const j of [...joueurs, spectateur]) j.socket.close();
  const ids = [...joueurs, spectateur, absent].map((j) => Number(j.id));
  await prisma.partie.deleteMany({ where: { organisateurId: { in: ids } } });
  await prisma.joueur.deleteMany({ where: { id: { in: ids } } });
  console.log(`\n✅ Loup-Garou : ${ok} vérifications OK`);
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error(`\n❌ Loup-Garou : ÉCHEC — ${e.message}`);
  await prisma.$disconnect();
  process.exit(1);
});
