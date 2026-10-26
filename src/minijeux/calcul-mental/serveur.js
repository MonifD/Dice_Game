/**
 * Mini-jeu : CALCUL MENTAL
 * Un calcul par tour. Mauvaise réponse = éliminé ; parmi les bonnes réponses, les plus lents sont éliminés.
 * Le temps est mesuré par le serveur.
 */
const { ErreurJeu, garderMeilleurs } = require('../../moteur/outils');

function genererCalcul(niveau, tour, rng) {
  const n = (a, b) => rng.entier(a, b);
  const facile = () => {
    const op = rng.choisir(['+', '-', '×']);
    if (op === '+') { const a = n(5, 60); const b = n(5, 60); return [`${a} + ${b}`, a + b]; }
    if (op === '-') { const a = n(20, 99); const b = n(1, a); return [`${a} − ${b}`, a - b]; }
    const a = n(2, 10); const b = n(2, 10); return [`${a} × ${b}`, a * b];
  };
  const moyen = () => {
    const forme = n(0, 3);
    if (forme === 0) { const a = n(11, 25); const b = n(3, 12); return [`${a} × ${b}`, a * b]; }
    if (forme === 1) { const b = n(3, 12); const q = n(4, 25); return [`${b * q} ÷ ${b}`, q]; }
    if (forme === 2) { const a = n(50, 400); const b = n(50, 400); const c = n(10, 99); return [`${a} + ${b} − ${c}`, a + b - c]; }
    const a = n(2, 9); const b = n(2, 9); const c = n(5, 50); return [`${a} × ${b} + ${c}`, a * b + c];
  };
  const difficile = () => {
    const forme = n(0, 3);
    if (forme === 0) { const a = n(21, 99); const b = n(11, 39); return [`${a} × ${b}`, a * b]; }
    if (forme === 1) { const a = n(12, 30); const b = n(3, 9); const c = n(100, 500); return [`${a} × ${b} − ${c}`, a * b - c]; }
    if (forme === 2) { const b = n(6, 19); const q = n(12, 60); const c = n(10, 99); return [`${b * q} ÷ ${b} + ${c}`, q + c]; }
    const a = n(11, 25); return [`${a}²`, a * a];
  };
  // en mode « progressif », la difficulté augmente avec les tours
  const niv = niveau === 'progressif' ? (tour <= 2 ? 'facile' : tour <= 5 ? 'moyen' : 'difficile') : niveau;
  return ({ facile, moyen, difficile })[niv]();
}

module.exports = {
  id: 'calcul-mental',
  ordre: 13,
  nom: 'Calcul mental',
  icone: '🧮',
  description: 'Résous le calcul le plus vite possible. Erreur = éliminé, et les plus lents sont éliminés aussi.',
  dureeTourDefaut: 20,
  parametres: [
    {
      cle: 'difficulte', libelle: 'Difficulté', type: 'choix', defaut: 'progressif',
      options: [{ valeur: 'facile', libelle: 'Facile' }, { valeur: 'moyen', libelle: 'Moyen' }, { valeur: 'difficile', libelle: 'Difficile' }, { valeur: 'progressif', libelle: 'Progressif (de plus en plus dur)' }],
    },
    { cle: 'pourcentLents', libelle: '% des plus lents éliminés (parmi les bonnes réponses)', type: 'nombre', min: 0, max: 80, defaut: 30 },
  ],

  async initialiser() { return {}; },
  async debutTour({ etat, params, tour, rng }) {
    const [expression, resultat] = genererCalcul(params.difficulte, tour, rng);
    return { etat: { ...etat, resultat }, public: { consigne: 'Calcule !', expression } };
  },

  action({ etat, donnees, ecouleMs }) {
    const r = Number(String(donnees.reponse ?? '').replace(',', '.').trim());
    if (!Number.isFinite(r)) throw new ErreurJeu('Entre un nombre.');
    const juste = r === etat.resultat;
    return { enregistrer: { reponse: r, juste, tempsMs: ecouleMs }, public: null, prive: { juste } };
  },

  async resoudreTour({ etat, actions, params }) {
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, ...a }));
    const justes = lignes.filter((l) => l.juste);
    const survivants = params.pourcentLents > 0
      ? garderMeilleurs(justes.map((l) => ({ id: l.joueurId, score: -l.tempsMs })), params.pourcentLents)
      : justes.map((l) => l.joueurId);
    return {
      etat, survivants, message: `Réponse : ${etat.resultat}`,
      details: { type: 'calcul', resultat: etat.resultat, erreurs: lignes.length - justes.length, lignes: justes.sort((a, b) => a.tempsMs - b.tempsMs) },
    };
  },
};
