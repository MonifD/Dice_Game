/**
 * Mini-jeu : ENCHÈRES À L'AVEUGLE
 * Chaque joueur reçoit des points au départ. À chaque tour, il mise en secret une partie de ses points.
 * La plus petite mise est éliminée (ou un pourcentage des plus petites, pour les grands groupes).
 * Les points misés sont dépensés : il faut gérer son budget !
 */
const { ErreurJeu, garderMeilleurs } = require('../../moteur/outils');

module.exports = {
  id: 'encheres',
  ordre: 16,
  nom: 'Enchères à l\'aveugle',
  icone: '💎',
  description: 'Tu as un budget de points. À chaque tour, mise en secret : la plus petite mise est éliminée. Les points misés sont perdus.',
  /** Règles affichées en salle d'attente (p = paramètres de la partie). */
  regles: (p) => [
    `Tu commences avec ${p.points} points.`,
    'À chaque tour, mise en secret une partie de tes points.',
    `${p.elimination === 'min' ? 'La plus petite mise est éliminée' : `Les ${p.elimination} % plus petites mises sont éliminées`}.`,
    'Les points misés sont perdus : gère ton budget pour tenir jusqu\'au bout !',
  ],
  dureeTourDefaut: 25,
  parametres: [
    { cle: 'points', libelle: 'Points de départ', type: 'nombre', min: 10, max: 10000, defaut: 100 },
    {
      cle: 'elimination', libelle: 'Éliminés à chaque tour', type: 'choix', defaut: 'min',
      options: [{ valeur: 'min', libelle: 'Seulement la (les) plus petite(s) mise(s)' }, { valeur: '25', libelle: 'Les 25 % plus petites mises' }, { valeur: '50', libelle: 'Les 50 % plus petites mises' }],
      aide: 'Avec beaucoup de joueurs, choisis 25 % ou 50 % pour aller plus vite.',
    },
  ],

  async initialiser({ params, joueurs }) {
    return { points: Object.fromEntries(joueurs.map((j) => [j.id, params.points])) };
  },
  async debutTour({ etat }) { return { etat, public: { consigne: 'Mise en secret ! La plus petite mise est éliminée.' } }; },

  action({ etat, joueurId, donnees }) {
    const mise = Number(donnees.mise);
    const dispo = etat.points[joueurId] ?? 0;
    if (!Number.isInteger(mise) || mise < 0) throw new ErreurJeu('Mise invalide.');
    if (mise > dispo) throw new ErreurJeu(`Tu n'as que ${dispo} points.`);
    return { enregistrer: { mise }, public: null, prive: { mise, reste: dispo - mise } };
  },

  async resoudreTour({ etat, actions, params }) {
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, mise: a.mise }));
    let survivants;
    let message = null;
    if (params.elimination === 'min') {
      const min = Math.min(...lignes.map((l) => l.mise));
      survivants = lignes.filter((l) => l.mise > min).map((l) => l.joueurId);
      // finale toujours en duel : à 3 joueurs ou plus, une égalité en bas n'élimine pas tout le monde sauf un
      if (lignes.length > 2 && survivants.length === 1) {
        survivants = lignes.map((l) => l.joueurId);
        message = 'Plusieurs joueurs à égalité sur la plus petite mise : personne n\'est éliminé ce tour-ci.';
      }
    } else {
      survivants = garderMeilleurs(lignes.map((l) => ({ id: l.joueurId, score: l.mise })), Number(params.elimination));
    }
    const points = { ...etat.points };
    for (const l of lignes) points[l.joueurId] -= l.mise;
    for (const id of Object.keys(points)) if (!survivants.includes(id)) delete points[id];
    return {
      etat: { ...etat, points }, survivants, message,
      details: { type: 'encheres', lignes: lignes.sort((a, b) => b.mise - a.mise) },
    };
  },

  vuePublique({ etat }) { return { points: etat.points }; },
};
