/**
 * Tour de départage (« mort subite »), commun à tous les mini-jeux.
 * Utilisé quand une partie se termine (toursMax atteint ou mini-jeu épuisé)
 * avec plusieurs joueurs encore à égalité.
 *
 * Chaque joueur clique « Tenter ma chance » : le serveur tire un nombre de 1 à 1000.
 * Le plus haut gagne ; en cas d'égalité au sommet, les ex aequo rejouent.
 */
module.exports = {
  id: '_departage',
  nom: 'Mort subite',
  description: 'Tirage de 1 à 1000 : le plus haut l\'emporte.',
  icone: '⚡',
  async initialiser() { return {}; },
  async debutTour({ etat }) {
    return { etat, public: { consigne: 'Mort subite ! Clique pour tirer un nombre de 1 à 1000.' } };
  },
  action({ rng }) {
    const valeur = rng.entier(1, 1000);
    return { enregistrer: { valeur }, public: { valeur }, prive: { valeur } };
  },
  async resoudreTour({ etat, actions }) {
    const lignes = Object.entries(actions).map(([id, a]) => ({ joueurId: id, valeur: a.valeur }));
    const max = Math.max(...lignes.map((l) => l.valeur));
    return {
      etat,
      survivants: lignes.filter((l) => l.valeur === max).map((l) => l.joueurId),
      details: { type: 'departage', lignes, max },
    };
  },
};
