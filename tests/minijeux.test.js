/**
 * Tests unitaires des mini-jeux et des outils du moteur (sans base de données ni réseau).
 *   npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const { rng, garderMeilleurs, ErreurJeu } = require('../src/moteur/outils');
const { validerParametres } = require('../src/moteur/parametres');
const registre = require('../src/minijeux');

test('garderMeilleurs : élimine la moitié la plus basse, garde les ex aequo', () => {
  const l = [1, 2, 3, 4, 5, 6].map((s, i) => ({ id: `j${i}`, score: s }));
  assert.deepStrictEqual(garderMeilleurs(l, 50).sort(), ['j3', 'j4', 'j5']);
  const ex = [{ id: 'a', score: 5 }, { id: 'b', score: 5 }, { id: 'c', score: 5 }, { id: 'd', score: 1 }];
  assert.deepStrictEqual(garderMeilleurs(ex, 50).sort(), ['a', 'b', 'c']); // pas de tirage au sort entre ex aequo
  assert.deepStrictEqual(garderMeilleurs([{ id: 'x', score: 1 }, { id: 'y', score: 1 }], 50).sort(), ['x', 'y']); // égalité totale
  assert.deepStrictEqual(garderMeilleurs([{ id: 'x', score: 2 }, { id: 'y', score: 1 }], 10), ['x']); // au moins 1 éliminé
});

test('rng : bornes respectées', () => {
  for (let i = 0; i < 2000; i++) { const n = rng.entier(1, 6); assert.ok(n >= 1 && n <= 6); }
  assert.strictEqual(new Set(rng.melanger([1, 2, 3, 4])).size, 4);
});

test('paramètres : valeurs par défaut et validation', () => {
  const des = registre.obtenir('des');
  const p = validerParametres(des, {});
  assert.strictEqual(p.nombreCible, 6);
  assert.strictEqual(p.dureeTour, 20);
  assert.strictEqual(p.avanceAuto, true);
  assert.throws(() => validerParametres(des, { nombreCible: 7 }), ErreurJeu);
  assert.throws(() => validerParametres(registre.obtenir('portes'), { nbPortes: 3, nbPiegees: 3 }), ErreurJeu);
});

test('dé : qualification sur le nombre cible puis plus haut résultat', async () => {
  const m = registre.obtenir('des');
  let etat = await m.initialiser({ params: { nombreCible: 4 } });
  const r1 = await m.resoudreTour({ etat, actions: { a: { valeur: 4 }, b: { valeur: 2 }, c: { valeur: 4 } } });
  assert.deepStrictEqual(r1.survivants.sort(), ['a', 'c']);
  etat = r1.etat;
  assert.strictEqual(etat.phase, 'finale');
  const r2 = await m.resoudreTour({ etat, actions: { a: { valeur: 5 }, c: { valeur: 3 } } });
  assert.deepStrictEqual(r2.survivants, ['a']);
  const r3 = await m.resoudreTour({ etat: await m.initialiser({ params: { nombreCible: 6 } }), actions: { a: { valeur: 1 } } });
  assert.deepStrictEqual(r3.survivants, []); // -> le moteur rejoue le tour 1
});

test('minorité : la minorité survit, égalité = tout le monde, unanimité = rejeu', async () => {
  const m = registre.obtenir('minorite');
  const etat = await m.initialiser({ params: { optionA: 'A', optionB: 'B' } });
  const r = await m.resoudreTour({ etat, actions: { a: { choix: 'A' }, b: { choix: 'B' }, c: { choix: 'B' } } });
  assert.deepStrictEqual(r.survivants, ['a']);
  assert.strictEqual((await m.resoudreTour({ etat, actions: { a: { choix: 'A' }, b: { choix: 'B' } } })).survivants.length, 2);
  assert.strictEqual((await m.resoudreTour({ etat, actions: { a: { choix: 'A' }, b: { choix: 'A' } } })).survivants.length, 0);
});

test('enchères : la plus petite mise est éliminée et les points sont dépensés', async () => {
  const m = registre.obtenir('encheres');
  const etat = await m.initialiser({ params: { points: 100 }, joueurs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  assert.throws(() => m.action({ etat, joueurId: 'a', donnees: { mise: 101 } }), ErreurJeu);
  const r = await m.resoudreTour({ etat, actions: { a: { mise: 10 }, b: { mise: 30 }, c: { mise: 30 } }, params: { elimination: 'min' } });
  assert.deepStrictEqual(r.survivants.sort(), ['b', 'c']);
  assert.deepStrictEqual(r.etat.points, { b: 70, c: 70 });
});

test('réflexe : cliquer avant le vert = trop tôt', async () => {
  const m = registre.obtenir('reflexe');
  const { etat } = await m.debutTour({ etat: {}, rng, params: { fenetre: 4 } });
  assert.ok(m.action({ etat, ecouleMs: etat.vertMs - 500 }).enregistrer.tropTot);
  assert.strictEqual(m.action({ etat, ecouleMs: etat.vertMs + 250 }).enregistrer.tempsMs, 250);
});

test('feu rouge : clic au rouge = attrapé, cadence plafonnée', async () => {
  const m = registre.obtenir('feu-rouge');
  const { etat } = await m.debutTour({ etat: {}, rng, params: { dureeTour: 20 } });
  assert.ok(m.action({ etat, donnees: { pas: 1 }, ecouleMs: 100 }).enregistrer.attrape); // départ au rouge
  const vert = etat.feux.find((f) => f.couleur === 'vert');
  const r = m.action({ etat, donnees: { pas: 30 }, precedent: { pas: 0, dernierMs: vert.dansMs }, ecouleMs: vert.dansMs + 200 });
  assert.ok(r.enregistrer.pas <= 5, `plafond dépassé : ${r.enregistrer.pas}`);
});

test('juste prix : génère une image PNG valide', async () => {
  const m = registre.obtenir('juste-prix');
  const r = await m.debutTour({ etat: {}, rng, params: { min: 20, max: 40, affichage: 3 } });
  assert.match(r.public.image, /^data:image\/png;base64,iVBORw0KGgo/);
  assert.ok(r.etat.bonne >= 20 && r.etat.bonne <= 40);
  assert.ok(!JSON.stringify(r.public).includes(`"bonne"`));
});

test('tous les mini-jeux : un tour complet avec 20 joueurs donne des survivants valides', async () => {
  const donnees = {
    'pile-ou-face': () => ({ choix: rng.choisir(['pile', 'face']) }),
    minorite: () => ({ choix: rng.choisir(['A', 'B']) }),
    'nombre-mystere': () => ({ nombre: rng.entier(1, 100) }),
    'pierre-feuille-ciseaux': () => ({ coup: rng.choisir(['pierre', 'feuille', 'ciseaux']) }),
    portes: () => ({ porte: rng.entier(1, 3) }),
    'feu-rouge': () => ({ pas: 2 }),
    'course-clics': () => ({ clics: rng.entier(1, 5) }),
    quiz: () => ({ reponse: rng.entier(0, 1) }),
    'juste-prix': () => ({ estimation: rng.entier(30, 250) }),
    'calcul-mental': () => ({ reponse: rng.entier(0, 50) }),
    memoire: (pub) => ({ sequence: Array.from({ length: pub.longueur }, () => 'rouge') }),
    encheres: () => ({ mise: rng.entier(0, 50) }),
  };
  const faussePrisma = { questionQuiz: { findMany: async () => [{ question: 'Q ?', choix: ['oui', 'non'], bonneReponse: 0, categorie: 'Test' }] } };
  const joueurs = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), pseudo: `J${i + 1}` }));
  const enJeu = joueurs.map((j) => j.id);
  for (const m of registre.registre.values()) {
    const params = validerParametres(m, {});
    let etat = await m.initialiser({ params, joueurs, rng, outils: { prisma: faussePrisma } });
    const d = await m.debutTour({ etat, tour: 1, essai: 0, enJeu, params, rng });
    etat = d.etat ?? etat;
    const actions = {};
    if (m.actionRequise !== false) {
      for (const id of enJeu) {
        const ecouleMs = m.id === 'course-clics' ? 3500 : m.id === 'feu-rouge' ? (etat.feux.find((f) => f.couleur === 'vert')?.dansMs ?? 0) + 10 : 1000;
        let r;
        try {
          r = await m.action({ etat, joueurId: id, donnees: (donnees[m.id] || (() => ({})))(d.public), precedent: undefined, ecouleMs, params, rng, tour: 1 });
        } catch (e) {
          throw new Error(`${m.id} : action refusée (« ${e.message} »). Si c'est un nouveau mini-jeu, ajoute ce qu'un joueur envoie `
            + `dans « donnees » en haut de ce test (tests/minijeux.test.js), ex. '${m.id}': () => ({ choix: 'A' }),`);
        }
        actions[id] = r.enregistrer;
      }
    }
    const res = await m.resoudreTour({ etat, actions, enJeu, params, rng, tour: 1 });
    assert.ok(Array.isArray(res.survivants), `${m.id} : survivants manquants`);
    assert.ok(res.survivants.every((id) => enJeu.includes(String(id))), `${m.id} : survivant inconnu`);
    assert.ok(res.survivants.length <= enJeu.length, m.id);
    JSON.stringify(res.details); // les détails doivent être sérialisables
  }
});

test('chaque mini-jeu a une stratégie de bot pour le test de charge', () => {
  const strategies = require('./strategies');
  const manquants = [...registre.registre.keys()].filter((id) => !strategies[id]);
  assert.deepStrictEqual(manquants, [], `stratégie de bot manquante pour : ${manquants.join(', ')} -> ajoute-la dans tests/strategies.js`);
});

test('chaque mini-jeu a un affichage client.js', () => {
  const fs = require('fs');
  const path = require('path');
  const manquants = [...registre.registre.values()].filter((m) => !fs.existsSync(path.join(m.dossier, 'client.js'))).map((m) => m.id);
  assert.deepStrictEqual(manquants, [], `client.js manquant pour : ${manquants.join(', ')}`);
});
