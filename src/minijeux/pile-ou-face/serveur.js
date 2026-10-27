/**
 * Mini-jeu : PILE OU FACE
 * Chaque joueur parie pile ou face ; le serveur lance la pièce à la fin du tour.
 * Ceux qui se trompent sont éliminés (si tout le monde se trompe, le tour est rejoué).
 */
const { ErreurJeu } = require('../../moteur/outils');

module.exports = {
  id: 'pile-ou-face',
  ordre: 2,
  nom: 'Pile ou face',
  icone: '🌕',
  description: 'Parie pile ou face. La pièce est lancée à la fin du tour : ceux qui se trompent sont éliminés.',
  /** Règles affichées en salle d'attente (p = paramètres de la partie). */
  regles: () => [
    'Choisis Pile ou Face avant la fin du chrono.',
    'La pièce est lancée à la fin du tour : ceux qui se sont trompés sont éliminés.',
    'Si tout le monde s\'est trompé, le tour est rejoué entre eux.',
  ],
  dureeTourDefaut: 15,
  parametres: [],

  async initialiser() { return {}; },
  async debutTour({ etat }) { return { etat, public: { consigne: 'Pile ou face ?' } }; },

  action({ donnees }) {
    const choix = donnees.choix;
    if (!['pile', 'face'].includes(choix)) throw new ErreurJeu('Choisis pile ou face.');
    // le choix reste caché jusqu'aux résultats
    return { enregistrer: { choix }, public: null, prive: { choix } };
  },

  async resoudreTour({ etat, actions, rng }) {
    const resultat = rng.choisir(['pile', 'face']);
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, choix: a.choix }));
    return {
      etat,
      survivants: lignes.filter((l) => l.choix === resultat).map((l) => l.joueurId),
      message: `La pièce est tombée sur ${resultat.toUpperCase()} !`,
      details: { type: 'pile-ou-face', resultat, pile: lignes.filter((l) => l.choix === 'pile').length, face: lignes.filter((l) => l.choix === 'face').length },
    };
  },
};
