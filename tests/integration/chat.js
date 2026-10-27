#!/usr/bin/env node
/**
 * TEST D'INTÉGRATION — chat temps réel (serveur lancé + base de données).
 *
 *   node tests/integration/chat.js [--url http://localhost:3000]
 *
 * Variables : DATABASE_URL, JWT_SECRET (comme le serveur).
 * Crée 2 comptes de test + utilise le super admin, puis les supprime.
 */
require('dotenv').config({ quiet: true });
const assert = require('assert');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const prisma = require('../../src/db/prisma');

const i = process.argv.indexOf('--url');
const URL = (i > 0 ? process.argv[i + 1] : `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const SECRET = process.env.JWT_SECRET || 'secret-de-developpement-a-changer';
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const em = (s, e, d) => new Promise((r) => s.timeout(8000).emit(e, d, (err, rep) => r(err ? { ok: false, erreur: 'timeout' } : rep)));
const connecter = (id) => new Promise((res, rej) => {
  const s = io(URL, { path: process.env.SOCKET_PATH || '/api/socket.io', transports: ['websocket'], auth: { token: jwt.sign({ sub: id }, SECRET, { expiresIn: '10m' }) } });
  s.once('connect', () => res(s));
  s.once('connect_error', rej);
});
let ok = 0;
const verifier = (nom, condition, detail = '') => { assert.ok(condition, `${nom} ${detail}`); ok++; console.log(`  ✓ ${nom}`); };

(async () => {
  const suffixe = Date.now().toString(36);
  const [j1, j2] = await Promise.all([1, 2].map((n) => prisma.joueur.create({
    data: { pseudo: `ci_chat${n}_${suffixe}`, pseudoNormalise: `ci_chat${n}_${suffixe}`, motDePasseHash: '!' },
  })));
  const admin = await prisma.joueur.findFirst({ where: { role: 'SUPER_ADMIN', actif: true } });
  assert.ok(admin, 'aucun super admin actif en base');
  const [sa, s1, s2] = await Promise.all([connecter(admin.id), connecter(j1.id), connecter(j2.id)]);

  try {
    const recus = [];
    s2.on('chat:message', (m) => recus.push(m));
    for (const s of [sa, s1, s2]) assert.ok((await em(s, 'chat:rejoindre', { canal: 'general' })).ok);

    let r = await em(s1, 'chat:envoyer', { canal: 'general', texte: '  Salut <b>tout</b> le monde  ' });
    await attendre(200);
    verifier('message diffusé aux autres joueurs', r.ok && recus.at(-1)?.texte === 'Salut <b>tout</b> le monde', JSON.stringify(r));
    r = await em(s1, 'chat:envoyer', { canal: 'general', texte: 'trop vite' });
    verifier('anti-flood', !r.ok);
    verifier('200 caractères max', !(await em(s1, 'chat:envoyer', { canal: 'general', texte: 'x'.repeat(201) })).ok);
    verifier('salon d\'une salle inexistante refusé', !(await em(s1, 'chat:envoyer', { canal: 'salle:ZZZZZZ', texte: 'hey' })).ok);
    verifier('salon invalide refusé', !(await em(s1, 'chat:envoyer', { canal: 'n importe quoi', texte: 'hey' })).ok);

    const idMsg = recus.at(-1).id;

    // réponses
    verifier('réponse à un message inconnu refusée', !(await em(s2, 'chat:envoyer', { canal: 'general', texte: 'hein ?', reponseA: 'ffffffffffff' })).ok);
    r = await em(s2, 'chat:envoyer', { canal: 'general', texte: 'Je te réponds :lw62:', reponseA: idMsg });
    await attendre(200);
    const reponse = recus.at(-1);
    verifier('réponse diffusée avec la citation', r.ok && reponse?.reponse?.id === idMsg && reponse.reponse.auteur.pseudo === j1.pseudo && reponse.reponse.texte === 'Salut <b>tout</b> le monde', JSON.stringify(reponse));

    // réactions ❤ (62) / 🎉 (74)
    const reactions = [];
    s1.on('chat:reaction', (x) => reactions.push(x));
    r = await em(s2, 'chat:reagir', { canal: 'general', id: idMsg, emoji: 62 });
    await em(sa, 'chat:reagir', { canal: 'general', id: idMsg, emoji: 74 });
    await attendre(200);
    verifier('réaction ❤ diffusée', r.ok && reactions.some((x) => x.id === idMsg && x.reactions['62']?.some((p) => p.id === String(j2.id))), JSON.stringify(reactions));
    verifier('réaction non autorisée refusée', !(await em(s2, 'chat:reagir', { canal: 'general', id: idMsg, emoji: 5 })).ok);
    verifier('réaction sur un message inconnu refusée', !(await em(s2, 'chat:reagir', { canal: 'general', id: 'ffffffffffff', emoji: 62 })).ok);
    let reac = (await em(s1, 'chat:rejoindre', { canal: 'general' })).messages.find((m) => m.id === idMsg)?.reactions;
    verifier('réactions présentes dans l\'historique', reac?.['62']?.length === 1 && reac?.['74']?.length === 1, JSON.stringify(reac));
    await em(s2, 'chat:reagir', { canal: 'general', id: idMsg, emoji: 62 });
    reac = (await em(s1, 'chat:rejoindre', { canal: 'general' })).messages.find((m) => m.id === idMsg)?.reactions;
    verifier('2e clic = réaction retirée', !reac?.['62'] && reac?.['74']?.length === 1, JSON.stringify(reac));
    verifier('un R1 ne supprime pas le message d\'un autre', !(await em(s2, 'chat:supprimer', { canal: 'general', id: idMsg })).ok);
    verifier('un R1 ne peut pas rendre muet', !(await em(s2, 'chat:muet', { joueurId: j1.id, minutes: 5 })).ok);

    const supprimes = [];
    s2.on('chat:supprime', (x) => supprimes.push(x));
    r = await em(sa, 'chat:supprimer', { canal: 'general', id: idMsg });
    await attendre(200);
    const hist = await em(s2, 'chat:rejoindre', { canal: 'general' });
    verifier('suppression par le super admin (diffusée et retirée de l\'historique)', r.ok && supprimes.length === 1 && !hist.messages.some((m) => m.id === idMsg));
    const citee = hist.messages.find((m) => m.id === reponse.id)?.reponse;
    verifier('la citation d\'un message supprimé est effacée', citee?.supprime === true && citee.texte === '', JSON.stringify(citee));

    let muet = null;
    s1.on('chat:muet', (x) => { muet = x; });
    r = await em(sa, 'chat:muet', { joueurId: j1.id, minutes: 5 });
    await attendre(1100);
    verifier('rendre muet', r.ok && muet?.muetMs > 0 && !(await em(s1, 'chat:envoyer', { canal: 'general', texte: 'je parle ?' })).ok);
    await em(sa, 'chat:muet', { joueurId: j1.id, minutes: 0 });
    verifier('lever la sanction', (await em(s1, 'chat:envoyer', { canal: 'general', texte: 'je reparle' })).ok);
    verifier('personne ne rend le super admin muet', !(await em(s1, 'chat:muet', { joueurId: admin.id, minutes: 5 })).ok);

    console.log(`\n✅ Chat : ${ok} vérifications OK`);
  } finally {
    [sa, s1, s2].forEach((s) => s.close());
    await prisma.joueur.deleteMany({ where: { id: { in: [j1.id, j2.id] } } });
    await prisma.$disconnect();
  }
  process.exit(0);
})().catch(async (e) => {
  console.error(`\n❌ Chat : ÉCHEC — ${e.message}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
