#!/usr/bin/env node
/**
 * TEST DE CHARGE : simule N joueurs (100 par défaut) qui jouent une partie complète.
 *
 *   node tests/charge.js --joueurs 100 --jeu des [--url http://localhost:3000] [--params '{"dureeTour":8}']
 *   node tests/charge.js --tous            # enchaîne une partie de chaque mini-jeu
 *   node tests/charge.js --urls http://localhost:3000,http://localhost:3001   # joueurs répartis sur 2 instances
 *
 * Nécessite les mêmes variables que le serveur (DATABASE_URL, JWT_SECRET) : les comptes
 * « Bot001… » sont créés directement en base et leurs jetons signés localement
 * (on contourne volontairement la limitation des tentatives de connexion).
 * À lancer AVANT la mise en production, sur un environnement de test.
 */
require('dotenv').config({ quiet: true });
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../src/db/prisma');
const strategies = require('./strategies');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, t) => {
  if (a.startsWith('--')) acc.push([a.slice(2), t[i + 1] && !t[i + 1].startsWith('--') ? t[i + 1] : true]);
  return acc;
}, []));
const URLS = (args.urls || args.url || `http://localhost:${process.env.PORT || 3000}`).split(',');
const URL = URLS[0];
const N = parseInt(args.joueurs || '100', 10);
const PATH = process.env.SOCKET_PATH || '/api/socket.io';
const SECRET = process.env.JWT_SECRET || 'secret-de-developpement-a-changer';

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const jeton = (id) => jwt.sign({ sub: id }, SECRET, { expiresIn: '2h' });

async function preparerComptes() {
  const hash = await bcrypt.hash('bot-mdp-123', 4);
  const bots = [];
  for (let i = 1; i <= N; i++) {
    const pseudo = `Bot${String(i).padStart(3, '0')}`;
    bots.push(await prisma.joueur.upsert({
      where: { pseudoNormalise: pseudo.toLowerCase() }, update: { actif: true },
      create: { pseudo, pseudoNormalise: pseudo.toLowerCase(), motDePasseHash: hash },
    }));
  }
  const org = await prisma.joueur.upsert({
    where: { pseudoNormalise: 'botorganisateur' }, update: { rang: 'R5', actif: true },
    create: { pseudo: 'BotOrganisateur', pseudoNormalise: 'botorganisateur', motDePasseHash: hash, rang: 'R5' },
  });
  return { bots, org };
}

function connecter(id, i = 0) {
  return new Promise((resolve, reject) => {
    const s = io(URLS[i % URLS.length], { path: PATH, transports: ['websocket'], auth: { token: jeton(id) }, reconnection: true });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

const emettre = (s, ev, d) => new Promise((resolve) => {
  const t0 = Date.now();
  s.timeout(10000).emit(ev, d, (err, r) => resolve({ ...(err ? { ok: false, erreur: 'timeout' } : r), ms: Date.now() - t0 }));
});

async function unePartie(miniJeu, { bots, org }) {
  const strat = strategies[miniJeu];
  if (!strat) throw new Error(`Pas de stratégie de bot pour ${miniJeu}`);
  const params = { dureeTour: 6, pauseResultats: 2, ...(strat.params || {}), ...(args.params ? JSON.parse(args.params) : {}) };

  const rep = await fetch(`${URL}/api/salles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton(org.id)}` },
    body: JSON.stringify({ miniJeu, parametres: params }),
  });
  const { code, erreur } = await rep.json();
  if (!code) throw new Error(`Création de salle refusée : ${erreur}`);

  const stats = { latences: [], erreurs: {}, tours: 0, debut: Date.now() };
  const orga = await connecter(org.id);
  await emettre(orga, 'salle:observer', { code });

  const t0 = Date.now();
  const sockets = await Promise.all(bots.map((b, i) => connecter(b.id, i)));
  const tConnexion = Date.now() - t0;
  await Promise.all(sockets.map((s) => emettre(s, 'salle:observer', { code })));
  const inscriptions = await Promise.all(sockets.map((s) => emettre(s, 'salle:inscrire', { code })));
  const refusees = inscriptions.filter((r) => !r.ok);
  if (refusees.length) console.warn('  inscriptions refusées :', refusees.slice(0, 3));

  const fin = new Promise((resolve) => {
    sockets.forEach((s, i) => {
      const moi = String(bots[i].id);
      let dejaJoue = '';
      const jouer = async (etat) => {
        if (etat.phase !== 'tour' || !etat.tourCourant) return;
        const tc = etat.tourCourant;
        const cle = `${tc.numero}:${tc.essai}`;
        const j = etat.joueurs.find((x) => x.id === moi);
        if (!j || j.statut !== 'enJeu' || dejaJoue === cle || !etat.jeuActif.actionRequise) return;
        dejaJoue = cle;
        if (Math.random() < (strat.absents ?? 0.02)) return; // quelques absents pour tester l'élimination
        await strat.jouer({ etat, moi, envoyer: async (donnees) => {
          const r = await emettre(s, 'jeu:action', { code, donnees });
          stats.latences.push(r.ms);
          if (!r.ok) stats.erreurs[r.erreur] = (stats.erreurs[r.erreur] || 0) + 1;
          return r;
        }, s });
      };
      s.on('salle:etat', (etat) => {
        if (i === 0 && etat.phase === 'resultats') {
          stats.tours++;
          const r = etat.dernierResultat;
          console.log(`  tour ${r.tour}${r.essai ? ` (rejeu ${r.essai})` : ''}${r.departage ? ' [mort subite]' : ''} : `
            + `${r.survivants.length} restent, ${r.elimines.length} éliminés (${r.absents.length} absents)${r.rejoue ? ' — REJOUÉ' : ''}`);
        }
        if (etat.phase === 'termine') { if (i === 0) resolve(etat); return; }
        jouer(etat).catch((e) => console.error(e));
      });
      if (strat.surEvenement) s.on('jeu:evenement', (ev) => strat.surEvenement({ ev, moi, s, code, emettre, stats }));
    });
  });

  const lancement = await emettre(orga, 'salle:lancer', { code });
  if (!lancement.ok) throw new Error(`Lancement refusé : ${lancement.erreur}`);
  const etatFinal = await Promise.race([fin, attendre(10 * 60 * 1000).then(() => null)]);

  const l = stats.latences.sort((a, b) => a - b);
  const pc = (p) => l[Math.min(l.length - 1, Math.floor(l.length * p))] ?? 0;
  console.log(`  -> ${etatFinal ? `gagnant : ${etatFinal.gagnant?.pseudo}` : 'TIMEOUT'} | ${stats.tours} tours en ${((Date.now() - stats.debut) / 1000).toFixed(1)} s`
    + ` | connexion ${N} sockets : ${tConnexion} ms | actions : ${l.length}, latence médiane ${pc(0.5)} ms, p95 ${pc(0.95)} ms, max ${pc(1)} ms`);
  if (Object.keys(stats.erreurs).length) console.log('  erreurs :', stats.erreurs);

  const partie = await prisma.partie.findUnique({ where: { code }, include: { gagnant: true, _count: { select: { participations: true } } } });
  console.log(`  base : statut ${partie.statut}, gagnant ${partie.gagnant?.pseudo}, ${partie._count.participations} participations, ${partie.nbTours} tours`);
  sockets.forEach((s) => s.close());
  orga.close();
  return { ok: !!etatFinal?.gagnant && partie.statut === 'TERMINEE' && partie.gagnant?.pseudo === etatFinal.gagnant.pseudo, code };
}

(async () => {
  const comptes = await preparerComptes();
  const jeux = args.tous ? Object.keys(strategies) : [args.jeu || 'des'];
  const bilan = [];
  for (const j of jeux) {
    console.log(`\n=== ${j} — ${N} joueurs${URLS.length > 1 ? ` sur ${URLS.length} instances` : ''} ===`);
    try { bilan.push([j, (await unePartie(j, comptes)).ok]); } catch (e) { console.error('  ÉCHEC', e.message); bilan.push([j, false]); }
  }
  console.log('\nBilan :', bilan.map(([j, ok]) => `${ok ? '✅' : '❌'} ${j}`).join('  '));
  await prisma.$disconnect();
  process.exit(bilan.every(([, ok]) => ok) ? 0 : 1);
})();
