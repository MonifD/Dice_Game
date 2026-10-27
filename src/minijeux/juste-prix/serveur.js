/**
 * Mini-jeu : LE JUSTE PRIX (estimation)
 * Une image remplie de points s'affiche quelques secondes ; chacun estime combien il y en a.
 * Les estimations les plus éloignées sont éliminées.
 * L'image est générée par le serveur (PNG) : impossible de lire le nombre dans le code de la page.
 */
const { ErreurJeu, garderMeilleurs } = require('../../moteur/outils');
const { dessinerDisques } = require('./png');

const COULEURS = [[245, 165, 36], [78, 161, 255], [63, 191, 111], [239, 75, 75], [200, 120, 255], [240, 240, 240]];

module.exports = {
  id: 'juste-prix',
  ordre: 12,
  nom: 'Le juste prix',
  icone: '💰',
  description: 'Une image pleine de points s\'affiche quelques secondes : estime combien il y en a. Les plus éloignés sont éliminés.',
  /** Règles affichées en salle d'attente (p = paramètres de la partie). */
  regles: (p) => [
    `Une image remplie de points s'affiche ${p.affichage} secondes : regarde bien !`,
    `Estime combien il y a de points (entre ${p.min} et ${p.max}).`,
    `Les ${p.pourcentElimines} % les plus éloignés du bon nombre sont éliminés.`,
  ],
  dureeTourDefaut: 20,
  parametres: [
    { cle: 'min', libelle: 'Nombre de points minimum', type: 'nombre', min: 5, max: 400, defaut: 30 },
    { cle: 'max', libelle: 'Nombre de points maximum', type: 'nombre', min: 10, max: 500, defaut: 250 },
    { cle: 'affichage', libelle: 'Durée d\'affichage de l\'image (secondes)', type: 'nombre', min: 1, max: 15, defaut: 4 },
    { cle: 'pourcentElimines', libelle: '% des plus éloignés éliminés', type: 'nombre', min: 10, max: 90, defaut: 50 },
  ],
  validerParametres(p) { if (p.min >= p.max) throw new ErreurJeu('Le minimum doit être inférieur au maximum.'); },

  async initialiser() { return {}; },

  async debutTour({ etat, params, rng }) {
    const n = rng.entier(params.min, params.max);
    const L = 520; const H = 340;
    const r = n > 250 ? 5 : n > 120 ? 6 : 8;
    const disques = [];
    let essais = 0;
    while (disques.length < n && essais < n * 400) {
      essais++;
      const x = r + 2 + rng.reel() * (L - 2 * r - 4);
      const y = r + 2 + rng.reel() * (H - 2 * r - 4);
      if (disques.every((d) => Math.hypot(d.x - x, d.y - y) > 2 * r + 2)) disques.push({ x, y, r, c: rng.choisir(COULEURS) });
    }
    const image = dessinerDisques(L, H, disques, [24, 29, 37], () => rng.reel());
    return {
      etat: { ...etat, bonne: disques.length },
      public: { consigne: `Combien de points ? (entre ${params.min} et ${params.max})`, image, affichageMs: params.affichage * 1000, min: params.min, max: params.max },
      evenements: [{ dansMs: params.affichage * 1000, type: 'cacher' }],
    };
  },

  action({ donnees, params }) {
    const n = Number(donnees.estimation);
    if (!Number.isInteger(n) || n < 0 || n > params.max * 3) throw new ErreurJeu('Estimation invalide.');
    return { enregistrer: { estimation: n }, public: null, prive: { estimation: n } };
  },

  async resoudreTour({ etat, actions, params }) {
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, estimation: a.estimation, ecart: Math.abs(a.estimation - etat.bonne) }));
    const survivants = garderMeilleurs(lignes.map((l) => ({ id: l.joueurId, score: -l.ecart })), params.pourcentElimines);
    return {
      etat, survivants, message: `Il y avait exactement ${etat.bonne} points !`,
      details: { type: 'juste-prix', bonne: etat.bonne, lignes: lignes.sort((a, b) => a.ecart - b.ecart) },
    };
  },
};
