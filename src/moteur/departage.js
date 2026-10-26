/**
 * Tour de départage (« mort subite »), commun à tous les mini-jeux.
 * Utilisé quand une partie se termine (toursMax atteint ou mini-jeu épuisé)
 * avec plusieurs joueurs encore à égalité.
 *
 * Chaque joueur clique « Tenter ma chance » : le serveur tire un nombre de 1 à 1000.
 * Les nombres restent SECRETS (même pour le joueur) jusqu'à ce que tout le monde ait tiré :
 * l'écran des résultats les révèle alors tous en même temps, chez tout le monde
 * (details.revelationMs = durée de l'animation). Le plus haut gagne ; égalité au sommet = les ex aequo rejouent.
 */
const ROULEMENT_MS = 3000; // les compteurs défilent, puis s'arrêtent tous ensemble
const MISE_EN_VALEUR_MS = 1800;

module.exports = {
  id: '_departage',
  nom: 'Mort subite',
  description: 'Tirage de 1 à 1000 : le plus haut l\'emporte.',
  icone: '⚡',
  async initialiser() { return {}; },
  async debutTour({ etat }) {
    return { etat, public: { consigne: 'Mort subite ! Clique pour tirer un nombre de 1 à 1000. Tous les tirages seront révélés en même temps.' } };
  },
  action({ rng }) {
    const valeur = rng.entier(1, 1000);
    // secret jusqu'à la révélation commune
    return { enregistrer: { valeur }, public: null, prive: null };
  },
  async resoudreTour({ etat, actions }) {
    const lignes = Object.entries(actions).map(([id, a]) => ({ joueurId: id, valeur: a.valeur })).sort((a, b) => b.valeur - a.valeur);
    const max = lignes[0]?.valeur;
    const survivants = lignes.filter((l) => l.valeur === max).map((l) => l.joueurId);
    return {
      etat, survivants,
      message: survivants.length > 1 ? `Égalité au sommet (${max}) : les ex aequo retirent un nombre !` : `⚡ Plus grand nombre : ${max} !`,
      details: { type: 'departage', lignes, max, roulementMs: ROULEMENT_MS, revelationMs: ROULEMENT_MS + MISE_EN_VALEUR_MS },
    };
  },
};
