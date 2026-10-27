/**
 * Mini-jeu : COURSE DE CLICS
 * Le plus de clics possible pendant le temps imparti ; la moitié la plus basse est éliminée.
 * Le navigateur envoie ses clics par paquets ; le serveur plafonne la cadence (anti auto-clic).
 */
const { ErreurJeu, garderMeilleurs } = require('../../moteur/outils');

module.exports = {
  id: 'course-clics',
  ordre: 10,
  nom: 'Course de clics',
  icone: '👆',
  description: 'Clique le plus vite possible pendant 10 secondes. Les moins rapides sont éliminés.',
  /** Règles affichées en salle d'attente (p = paramètres de la partie). */
  regles: (p) => [
    'Après un compte à rebours de 3 secondes, clique le plus vite possible sur le gros bouton.',
    `Tu as ${p.dureeTour} secondes. Les scores sont révélés à la fin.`,
    `Les ${p.pourcentElimines} % qui ont le moins cliqué sont éliminés.`,
    'Auto-clic interdit : au-delà d\'une certaine cadence, les clics ne comptent pas.',
  ],
  dureeTourDefaut: 10,
  parametres: [
    { cle: 'pourcentElimines', libelle: '% des plus lents éliminés', type: 'nombre', min: 10, max: 90, defaut: 50 },
    { cle: 'clicsMaxParSeconde', libelle: 'Cadence max autorisée (clics / s)', type: 'nombre', min: 5, max: 30, defaut: 16, aide: 'Au-delà, les clics sont ignorés (auto-clic).' },
  ],

  async initialiser() { return {}; },
  async debutTour({ etat, params }) {
    // 3 s de compte à rebours avant que les clics comptent, puis « dureeTour » secondes de clics
    return {
      etat,
      public: { consigne: 'Prépare-toi… puis clique comme un fou !', departMs: 3000 },
      evenements: [{ dansMs: 3000, type: 'go' }],
      dureeMs: 3000 + params.dureeTour * 1000,
    };
  },

  action({ donnees, precedent, ecouleMs, params }) {
    const departMs = 3000;
    if (ecouleMs < departMs - 150) throw new ErreurJeu('Attends le départ !');
    const n = Math.floor(Number(donnees.clics));
    if (!Number.isFinite(n) || n < 1 || n > 60) throw new ErreurJeu('Paquet de clics invalide.');
    const dernier = precedent?.dernierMs ?? departMs;
    const plafond = Math.ceil((Math.max(0, ecouleMs - dernier) / 1000) * params.clicsMaxParSeconde) + 2;
    const clics = (precedent?.clics || 0) + Math.min(n, plafond);
    return { enregistrer: { clics, dernierMs: ecouleMs }, fini: false, public: null, prive: { clics } };
  },

  async resoudreTour({ etat, actions, params }) {
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, clics: a.clics }));
    const survivants = garderMeilleurs(lignes.map((l) => ({ id: l.joueurId, score: l.clics })), params.pourcentElimines);
    return { etat, survivants, details: { type: 'course-clics', lignes: lignes.sort((a, b) => b.clics - a.clics) } };
  },
};
