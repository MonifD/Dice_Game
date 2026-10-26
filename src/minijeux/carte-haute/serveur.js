/**
 * Mini-jeu : LA CARTE LA PLUS HAUTE
 * Chaque joueur tire une carte (tirage serveur). Les plus basses sont éliminées.
 * Valeur : 2 < … < 10 < V < D < R < As ; à valeur égale, ♣ < ♦ < ♥ < ♠ si l'option « couleurs » est active.
 */
const VALEURS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R', 'A'];
const COULEURS = ['♣', '♦', '♥', '♠'];

module.exports = {
  id: 'carte-haute',
  ordre: 6,
  nom: 'La carte la plus haute',
  icone: '🃏',
  description: 'Chaque joueur tire une carte : les cartes les plus basses sont éliminées.',
  dureeTourDefaut: 15,
  parametres: [
    { cle: 'pourcentElimines', libelle: '% de joueurs éliminés par tour', type: 'nombre', min: 10, max: 90, defaut: 50 },
    { cle: 'couleurs', libelle: 'Les couleurs départagent (♣ < ♦ < ♥ < ♠)', type: 'booleen', defaut: false },
  ],

  async initialiser() { return {}; },
  async debutTour({ etat }) { return { etat, public: { consigne: 'Tire ta carte !' } }; },

  action({ rng, params }) {
    const v = rng.entier(0, VALEURS.length - 1);
    const c = rng.entier(0, COULEURS.length - 1);
    const carte = { valeur: VALEURS[v], couleur: COULEURS[c], score: params.couleurs ? v * 4 + c : v };
    return { enregistrer: carte, public: carte, prive: carte };
  },

  async resoudreTour({ etat, actions, params }) {
    const { garderMeilleurs } = require('../../moteur/outils');
    const lignes = Object.entries(actions).map(([joueurId, c]) => ({ joueurId, ...c }));
    const survivants = garderMeilleurs(lignes.map((l) => ({ id: l.joueurId, score: l.score })), params.pourcentElimines);
    return { etat, survivants, details: { type: 'carte-haute', lignes: lignes.sort((a, b) => b.score - a.score) } };
  },
};
