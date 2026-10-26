/**
 * Mini-jeu : ROUE DE LA FORTUNE
 * Aucune action : à chaque tour, la roue désigne au hasard les joueurs éliminés.
 */
module.exports = {
  id: 'roue',
  ordre: 15,
  nom: 'Roue de la fortune',
  icone: '🎡',
  description: 'Personne ne joue : la roue désigne au hasard les éliminés de chaque tour. Pur hasard !',
  actionRequise: false,
  parametresCommunsMasques: ['dureeTour'],
  parametres: [
    { cle: 'pourcentElimines', libelle: '% de joueurs éliminés par tour', type: 'nombre', min: 5, max: 90, defaut: 40 },
    { cle: 'dureeRotation', libelle: 'Durée de rotation de la roue (secondes)', type: 'nombre', min: 3, max: 20, defaut: 7 },
  ],

  async initialiser() { return {}; },
  async debutTour({ etat, params }) {
    return { etat, public: { consigne: 'La roue tourne… 🤞' }, dureeMs: params.dureeRotation * 1000 };
  },
  action() { return { enregistrer: null }; },

  async resoudreTour({ etat, enJeu, params, rng }) {
    const n = enJeu.length;
    // finale toujours en duel : à 3 joueurs ou plus, au moins 2 restent
    const nbElimines = Math.min(n > 2 ? n - 2 : n - 1, Math.max(1, Math.round((n * params.pourcentElimines) / 100)));
    const elimines = rng.echantillon(enJeu, nbElimines);
    return { etat, survivants: enJeu.filter((id) => !elimines.includes(id)), details: { type: 'roue', elimines } };
  },
};
