/** Loup-Garou : composition, nuit, jour, chasseur, amoureux, victoire, secrets (src/minijeux/loup-garou/logique.js). */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/minijeux/loup-garou/logique');
const { ErreurJeu } = require('../src/moteur/outils');

// rng prévisible : pas de mélange (les rôles suivent l'ordre de la composition), égalités -> premier
const rng = { melanger: (t) => [...t], choisir: (t) => t[0], entier: (a) => a };
const PARAMS = { cupidon: false, salvateur: false, nbLoups: 0, dureeNuit: 30, dureeDebat: 180, dureeVote: 60, revelerRoles: true };
const joueurs = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), pseudo: `J${i + 1}` }));
let t = 0;
const T = () => (t += 1000);

/** Crée une partie et renvoie { e, par: { ROLE: [ids] } }. */
function partie(n, params = {}) {
  const e = L.creer({ joueurs: joueurs(n), params: { ...PARAMS, ...params }, rng, maintenant: T() });
  const par = {};
  for (const id of e.ordre) (par[e.joueurs[id].role] ??= []).push(id);
  return { e, par };
}
const agir = (e, id, d) => L.action(e, id, d, T(), rng);
const avancer = (e) => L.avancer(e, T(), rng);
/** Avance jusqu'à la phase voulue (sans action). */
function jusqua(e, phase, etape = null, max = 30) {
  for (let i = 0; i < max && !(e.phase === phase && (!etape || e.etape === etape)); i++) avancer(e);
  assert.strictEqual(e.phase, phase, `phase ${phase} attendue, ${e.phase}/${e.etape}`);
}

test('composition : loups selon le nombre de joueurs, rôles de base et optionnels', () => {
  assert.deepStrictEqual(L.composition(6, PARAMS), { LOUP: 2, VILLAGEOIS: 1, VOYANTE: 1, SORCIERE: 1, CHASSEUR: 1 });
  assert.strictEqual(L.composition(9, PARAMS).LOUP, 3);
  assert.strictEqual(L.composition(13, PARAMS).LOUP, 4);
  assert.strictEqual(L.composition(18, PARAMS).LOUP, 4);
  const c = L.composition(10, { ...PARAMS, cupidon: true, salvateur: true, nbLoups: 2 });
  assert.deepStrictEqual(c, { LOUP: 2, VILLAGEOIS: 3, VOYANTE: 1, SORCIERE: 1, CHASSEUR: 1, CUPIDON: 1, SALVATEUR: 1 });
  assert.throws(() => L.composition(5, PARAMS), ErreurJeu, 'moins de 6');
  assert.throws(() => L.composition(19, PARAMS), ErreurJeu, 'plus de 18');
  assert.throws(() => L.composition(6, { ...PARAMS, nbLoups: 3 }), ErreurJeu, 'trop de loups');
});

test('nuit : voyante, loups, sorcière ; annonce le matin ; ordre des étapes', () => {
  const { e, par } = partie(8, { salvateur: true, cupidon: true });
  avancer(e); // distribution -> nuit 1
  assert.strictEqual(e.etape, 'cupidon');
  agir(e, par.CUPIDON[0], { cibles: [par.VILLAGEOIS[0], par.VOYANTE[0]] });
  assert.strictEqual(e.etape, 'salvateur');
  agir(e, par.SALVATEUR[0], { cible: par.VOYANTE[0] });
  assert.strictEqual(e.etape, 'voyante');
  assert.throws(() => agir(e, par.LOUP[0], { cible: par.VOYANTE[0] }), /pas à toi/);
  agir(e, par.VOYANTE[0], { cible: par.LOUP[0] });
  assert.strictEqual(L.vuePrivee(e, par.VOYANTE[0]).visions[0].role.id, 'LOUP');
  assert.strictEqual(e.etape, 'loups');
  assert.throws(() => agir(e, par.LOUP[0], { cible: par.LOUP[1] }), ErreurJeu, 'pas un loup');
  agir(e, par.LOUP[0], { cible: par.CHASSEUR[0] });
  assert.strictEqual(e.etape, 'loups', 'on attend l\'accord de tous les loups');
  agir(e, par.LOUP[1], { cible: par.CHASSEUR[0] });
  assert.strictEqual(e.etape, 'sorciere');
  assert.strictEqual(L.vuePrivee(e, par.SORCIERE[0]).action.victime, par.CHASSEUR[0]);
  agir(e, par.SORCIERE[0], { terminer: true });
  assert.strictEqual(e.phase, 'annonce');
  assert.deepStrictEqual(e.annonces.morts.map((m) => m.id), [par.CHASSEUR[0]]);
  assert.strictEqual(e.annonces.morts[0].cause, null, 'la cause d\'une mort de nuit n\'est pas annoncée');
  avancer(e); // le chasseur doit tirer
  assert.strictEqual(e.phase, 'chasseur');
  assert.strictEqual(L.vuePrivee(e, par.CHASSEUR[0]).action.type, 'chasseur');
  agir(e, par.CHASSEUR[0], { cible: par.LOUP[0] });
  assert.ok(!e.joueurs[par.LOUP[0]].vivant);
  avancer(e); // annonce du tir -> débat
  assert.strictEqual(e.phase, 'debat');
});

test('salvateur : la victime protégée survit ; pas deux nuits de suite la même personne', () => {
  const { e, par } = partie(8, { salvateur: true });
  jusqua(e, 'nuit', 'salvateur');
  agir(e, par.SALVATEUR[0], { cible: par.VILLAGEOIS[0] });
  jusqua(e, 'nuit', 'loups');
  agir(e, par.LOUP[0], { cible: par.VILLAGEOIS[0] });
  agir(e, par.LOUP[1], { cible: par.VILLAGEOIS[0] });
  assert.strictEqual(L.vuePrivee(e, par.SORCIERE[0]).action.victime, null, 'protégé : pas de victime pour la sorcière');
  jusqua(e, 'annonce');
  assert.strictEqual(e.annonces.morts.length, 0);
  assert.match(e.annonces.messages[0], /personne n'est mort/);
  jusqua(e, 'nuit', 'salvateur');
  assert.throws(() => agir(e, par.SALVATEUR[0], { cible: par.VILLAGEOIS[0] }), /nuit dernière/);
});

test('sorcière : potion de vie (pas sur elle-même) et potion de mort, une seule fois', () => {
  const { e, par } = partie(8);
  jusqua(e, 'nuit', 'loups');
  agir(e, par.LOUP[0], { cible: par.SORCIERE[0] });
  agir(e, par.LOUP[1], { cible: par.SORCIERE[0] });
  assert.throws(() => agir(e, par.SORCIERE[0], { potion: 'vie' }), /toi-même/);
  agir(e, par.SORCIERE[0], { potion: 'mort', cible: par.LOUP[0] });
  assert.throws(() => agir(e, par.SORCIERE[0], { potion: 'mort', cible: par.LOUP[1] }), /déjà utilisé/);
  agir(e, par.SORCIERE[0], { terminer: true });
  assert.deepStrictEqual(e.annonces.morts.map((m) => m.id).sort(), [par.SORCIERE[0], par.LOUP[0]].sort());

  const p2 = partie(8);
  jusqua(p2.e, 'nuit', 'loups');
  agir(p2.e, p2.par.LOUP[0], { cible: p2.par.VILLAGEOIS[0] });
  agir(p2.e, p2.par.LOUP[1], { cible: p2.par.VILLAGEOIS[0] });
  agir(p2.e, p2.par.SORCIERE[0], { potion: 'vie' });
  agir(p2.e, p2.par.SORCIERE[0], { terminer: true });
  assert.strictEqual(p2.e.annonces.morts.length, 0, 'sauvée par la potion de vie');
  assert.strictEqual(L.vuePrivee(p2.e, p2.par.SORCIERE[0]).potions.vie, false);
});

test('loups sans accord : le plus de voix ; égalité tirée au sort ; aucun vote = pas de victime', () => {
  const { e, par } = partie(9);
  jusqua(e, 'nuit', 'loups');
  agir(e, par.LOUP[0], { cible: par.VILLAGEOIS[0] });
  agir(e, par.LOUP[1], { cible: par.VILLAGEOIS[0] });
  agir(e, par.LOUP[2], { cible: par.VILLAGEOIS[1] });
  jusqua(e, 'annonce');
  assert.deepStrictEqual(e.annonces.morts.map((m) => m.id), [par.VILLAGEOIS[0]]);
  jusqua(e, 'nuit', 'loups');
  jusqua(e, 'annonce');
  assert.strictEqual(e.annonces.morts.length, 0, 'aucun loup n\'a voté');
});

test('vote du jour : majorité, second vote entre ex aequo, puis personne', () => {
  const { e, par } = partie(8);
  jusqua(e, 'vote');
  const v = L.vivants(e);
  assert.throws(() => agir(e, v[0], { cible: v[0] }), /toi-même/);
  agir(e, par.LOUP[0], { cible: par.VOYANTE[0] });
  agir(e, par.LOUP[1], { cible: par.VOYANTE[0] });
  agir(e, par.VILLAGEOIS[0], { cible: par.LOUP[0] });
  agir(e, par.VILLAGEOIS[1], { cible: par.LOUP[0] });
  assert.strictEqual(L.vuePublique(e).vote.votes.length, 4, 'les votes sont visibles en direct');
  avancer(e);
  assert.strictEqual(e.phase, 'vote2');
  assert.deepStrictEqual([...e.candidats].sort(), [par.VOYANTE[0], par.LOUP[0]].sort());
  assert.throws(() => agir(e, par.SORCIERE[0], { cible: par.VILLAGEOIS[0] }), /choix possibles/);
  agir(e, par.SORCIERE[0], { cible: par.LOUP[0] });
  avancer(e);
  assert.strictEqual(e.phase, 'annonce');
  assert.deepStrictEqual(e.annonces.morts.map((m) => [m.id, m.cause]), [[par.LOUP[0], 'vote']]);

  const p2 = partie(8);
  jusqua(p2.e, 'vote');
  agir(p2.e, p2.par.LOUP[0], { cible: p2.par.VOYANTE[0] });
  agir(p2.e, p2.par.VILLAGEOIS[0], { cible: p2.par.LOUP[1] });
  avancer(p2.e);
  agir(p2.e, p2.par.LOUP[0], { cible: p2.par.VOYANTE[0] });
  agir(p2.e, p2.par.VILLAGEOIS[0], { cible: p2.par.LOUP[1] });
  avancer(p2.e);
  assert.strictEqual(p2.e.annonces.morts.length, 0);
  assert.match(p2.e.annonces.messages[0], /égalité/);
});

test('amoureux : l\'un meurt, l\'autre meurt de chagrin ; couple mixte seul = victoire des amoureux', () => {
  const { e, par } = partie(8, { cupidon: true });
  jusqua(e, 'nuit', 'cupidon');
  agir(e, par.CUPIDON[0], { cibles: [par.LOUP[0], par.VILLAGEOIS[0]] });
  assert.strictEqual(L.vuePrivee(e, par.VILLAGEOIS[0]).partenaire.id, par.LOUP[0]);
  assert.strictEqual(L.vuePrivee(e, par.LOUP[1]).partenaire, null);
  jusqua(e, 'nuit', 'loups');
  agir(e, par.LOUP[0], { cible: par.VOYANTE[0] });
  agir(e, par.LOUP[1], { cible: par.VOYANTE[0] });
  jusqua(e, 'vote');
  agir(e, par.LOUP[1], { cible: par.VILLAGEOIS[0] });
  avancer(e);
  assert.deepStrictEqual(e.annonces.morts.map((m) => m.cause), ['vote', 'chagrin']);
  assert.ok(!e.joueurs[par.LOUP[0]].vivant, 'le loup amoureux est mort de chagrin');

  // couple mixte : on tue tout le monde sauf eux
  const p2 = partie(8, { cupidon: true });
  jusqua(p2.e, 'nuit', 'cupidon');
  agir(p2.e, p2.par.CUPIDON[0], { cibles: [p2.par.LOUP[0], p2.par.VILLAGEOIS[0]] });
  for (const id of p2.e.ordre) if (![p2.par.LOUP[0], p2.par.VILLAGEOIS[0]].includes(id)) { p2.e.joueurs[id].vivant = false; }
  assert.ok(L.verifierVictoire(p2.e, T()));
  assert.strictEqual(p2.e.fin.camp, 'amoureux');
  assert.deepStrictEqual(p2.e.fin.gagnants.sort(), [p2.par.LOUP[0], p2.par.VILLAGEOIS[0]].sort());
});

test('victoire : village si plus de loups, loups s\'ils sont aussi nombreux, égalité si tout le monde meurt', () => {
  const a = partie(6);
  a.par.LOUP.forEach((id) => { a.e.joueurs[id].vivant = false; });
  assert.ok(L.verifierVictoire(a.e, T()) && a.e.fin.camp === 'village');
  assert.ok(a.e.fin.gagnants.every((id) => a.e.joueurs[id].role !== 'LOUP'));
  const b = partie(6);
  ['VILLAGEOIS', 'VOYANTE'].forEach((r) => { b.e.joueurs[b.par[r][0]].vivant = false; });
  assert.ok(L.verifierVictoire(b.e, T()) && b.e.fin.camp === 'loups', '2 loups contre 2 villageois');
  const c = partie(6);
  c.e.ordre.forEach((id) => { c.e.joueurs[id].vivant = false; });
  assert.ok(L.verifierVictoire(c.e, T()) && c.e.fin.camp === 'egalite' && !c.e.fin.gagnants.length);
});

test('exclusion d\'un absent : mort, rôle révélé même si l\'option est désactivée', () => {
  const { e, par } = partie(8, { revelerRoles: false });
  jusqua(e, 'debat');
  L.exclure(e, par.VOYANTE[0], T());
  const pub = L.vuePublique(e).joueurs.find((j) => j.id === par.VOYANTE[0]);
  assert.ok(!pub.vivant && pub.role === 'VOYANTE' && pub.mort.cause === 'exclu');
  assert.strictEqual(e.phase, 'debat', 'la partie continue');
});

test('anti-triche : aucune information secrète dans la vue publique ni dans celle des autres', () => {
  const { e, par } = partie(12, { cupidon: true, salvateur: true, revelerRoles: false });
  jusqua(e, 'nuit', 'cupidon');
  agir(e, par.CUPIDON[0], { cibles: [par.VILLAGEOIS[0], par.LOUP[0]] });
  agir(e, par.SALVATEUR[0], { cible: par.VILLAGEOIS[1] });
  agir(e, par.VOYANTE[0], { cible: par.LOUP[1] });
  agir(e, par.LOUP[0], { cible: par.VILLAGEOIS[2] });
  const pub = JSON.stringify(L.vuePublique(e));
  for (const r of ['LOUP', 'VOYANTE', 'SORCIERE', 'CHASSEUR', 'CUPIDON', 'SALVATEUR', 'VILLAGEOIS']) assert.ok(!pub.includes(`"${r}"`) || pub.includes('"composition"'), r);
  assert.ok(L.vuePublique(e).joueurs.every((j) => j.role === null), 'aucun rôle visible');
  assert.strictEqual(L.vuePublique(e).vote, null);
  const villageois = L.vuePrivee(e, par.VILLAGEOIS[2]);
  assert.strictEqual(villageois.loups, null);
  assert.strictEqual(villageois.action, null, 'un villageois n\'a rien à faire la nuit');
  assert.ok(!JSON.stringify(villageois).includes(par.LOUP[1]), 'le villageois ne voit pas les loups');
  const loup = L.vuePrivee(e, par.LOUP[1]);
  assert.deepStrictEqual(loup.loups.map((x) => x.id).sort(), par.LOUP.sort());
  assert.strictEqual(loup.visions, null);
  assert.strictEqual(L.vuePrivee(e, 'inconnu'), null, 'spectateur : rien');
  // droits de chat
  assert.deepStrictEqual(L.droitsChat(e, par.VILLAGEOIS[2], 'village').ecrire, false, 'chat fermé la nuit');
  assert.ok(L.droitsChat(e, par.LOUP[0], 'loups').lire && !L.droitsChat(e, par.VILLAGEOIS[2], 'loups').lire);
  assert.ok(!L.droitsChat(e, par.VILLAGEOIS[2], 'morts').lire && L.droitsChat(e, 'spectateur', 'morts').lire);
});

test('déroulé complet sans action jusqu\'à une fin de partie (aucune boucle infinie)', () => {
  const { e, par } = partie(7);
  for (let tour = 0; tour < 400 && e.phase !== 'fin'; tour++) {
    if (e.phase === 'nuit' && e.etape === 'loups') {
      const cible = L.vivants(e).find((id) => e.joueurs[id].role !== 'LOUP');
      for (const l of par.LOUP) if (e.joueurs[l].vivant) agir(e, l, { cible });
      continue;
    }
    avancer(e);
  }
  assert.strictEqual(e.phase, 'fin');
  assert.strictEqual(e.fin.camp, 'loups');
  assert.ok(L.vuePublique(e).fin.roles.length === 7 && L.vuePublique(e).fin.resume.length >= 3);
});
