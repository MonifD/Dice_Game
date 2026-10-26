/**
 * Mini-jeu : RÉFLEXE
 * L'écran est rouge, puis passe au vert à un moment aléatoire (choisi et gardé secret par le serveur).
 * Cliquer avant le vert = éliminé. Parmi les autres, les plus lents sont éliminés.
 *
 * Le temps de réaction est mesuré PAR LE SERVEUR (réception du clic - émission du vert) :
 * impossible à truquer depuis le navigateur. Il inclut le temps réseau, ce qui avantage
 * un peu les bonnes connexions ; la marge « tolérance » compense en partie.
 */
const TOLERANCE_TOT_MS = 80; // un clic reçu juste avant le vert (décalage d'horloge) n'est pas « trop tôt »

module.exports = {
  id: 'reflexe',
  ordre: 8,
  nom: 'Réflexe',
  icone: '⚡',
  description: 'Clique dès que l\'écran passe au VERT. Trop tôt = éliminé ; les plus lents sont éliminés aussi.',
  parametresCommunsMasques: ['dureeTour'],
  parametres: [
    { cle: 'pourcentElimines', libelle: '% des plus lents éliminés', type: 'nombre', min: 10, max: 90, defaut: 50 },
    { cle: 'fenetre', libelle: 'Temps pour cliquer après le vert (secondes)', type: 'nombre', min: 2, max: 10, defaut: 4 },
  ],

  async initialiser() { return {}; },
  async debutTour({ etat, rng, params }) {
    const vertMs = rng.entier(2500, 7000); // secret : seul le serveur le connaît
    return {
      etat: { ...etat, vertMs },
      public: { consigne: 'Attends le VERT… puis clique le plus vite possible !' },
      evenements: [{ dansMs: vertMs, type: 'vert' }],
      dureeMs: vertMs + params.fenetre * 1000,
    };
  },

  action({ etat, ecouleMs }) {
    if (ecouleMs < etat.vertMs - TOLERANCE_TOT_MS) {
      return { enregistrer: { tropTot: true }, public: { tropTot: true }, prive: { tropTot: true } };
    }
    const tempsMs = Math.max(0, ecouleMs - etat.vertMs);
    return { enregistrer: { tempsMs }, public: { tempsMs }, prive: { tempsMs } };
  },

  async resoudreTour({ etat, actions, params }) {
    const { garderMeilleurs } = require('../../moteur/outils');
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, ...a }));
    const valides = lignes.filter((l) => !l.tropTot);
    const survivants = garderMeilleurs(valides.map((l) => ({ id: l.joueurId, score: -l.tempsMs })), params.pourcentElimines);
    return {
      etat, survivants,
      details: { type: 'reflexe', tropTot: lignes.filter((l) => l.tropTot).length, lignes: valides.sort((a, b) => a.tempsMs - b.tempsMs) },
    };
  },
};
