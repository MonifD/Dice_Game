/**
 * Mini-jeu : LANCER DE DÉ
 *
 * - L'organisateur choisit un nombre de 1 à 6.
 * - Tour 1 (qualification) : ceux qui obtiennent ce nombre passent, les autres sont éliminés.
 *   Si personne ne l'obtient, le moteur rejoue le tour (règle commune : plus aucun survivant).
 * - Tours suivants : seuls ceux qui font le plus haut résultat du tour passent.
 * Le dé est lancé par le SERVEUR (tirage cryptographique), jamais par le navigateur.
 */
module.exports = {
  id: 'des',
  ordre: 1,
  nom: 'Lancer de dé',
  icone: '🎲',
  description: 'Tour 1 : il faut faire le nombre choisi par l\'organisateur. Ensuite, seuls les plus hauts résultats passent.',
  /** Règles affichées en salle d'attente (p = paramètres de la partie). */
  regles: (p) => [
    `Tour 1 (qualification) : clique sur « Lancer le dé » ; il faut faire un ${p.nombreCible}. Ceux qui le font passent, les autres sont éliminés.`,
    'Si personne ne fait le bon nombre, le tour est rejoué.',
    'Tours suivants : seuls ceux qui font le plus haut résultat du tour passent.',
    'Le dé est lancé par le serveur : impossible de tricher.',
  ],
  dureeTourDefaut: 20,
  parametres: [
    { cle: 'nombreCible', libelle: 'Nombre à obtenir au tour 1', type: 'nombre', min: 1, max: 6, defaut: 6 },
  ],

  async initialiser({ params }) {
    return { phase: 'qualification', cible: params.nombreCible };
  },

  async debutTour({ etat }) {
    const consigne = etat.phase === 'qualification'
      ? `Lance le dé : il faut faire ${etat.cible} pour passer !`
      : 'Lance le dé : seuls les plus hauts résultats passent !';
    return { etat, public: { phase: etat.phase, cible: etat.cible, consigne } };
  },

  action({ rng }) {
    const valeur = rng.entier(1, 6);
    return { enregistrer: { valeur }, public: { valeur }, prive: { valeur } };
  },

  async resoudreTour({ etat, actions }) {
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, valeur: a.valeur }));
    const max = lignes.length ? Math.max(...lignes.map((l) => l.valeur)) : null;
    let survivants;
    let message;
    if (etat.phase === 'qualification') {
      survivants = lignes.filter((l) => l.valeur === etat.cible).map((l) => l.joueurId);
      message = survivants.length
        ? `${survivants.length} joueur(s) ont fait ${etat.cible} et passent au tour suivant.`
        : null; // le moteur rejoue le tour
    } else {
      survivants = lignes.filter((l) => l.valeur === max).map((l) => l.joueurId);
      message = `Plus haut résultat : ${max}. ${survivants.length} joueur(s) passent.`;
    }
    const phaseJouee = etat.phase;
    // (en cas de rejeu, le moteur ignore ce nouvel état et garde l'ancien)
    return {
      etat: { ...etat, phase: 'finale' },
      survivants,
      message,
      details: { type: 'des', phase: phaseJouee, cible: etat.cible, max, lignes },
    };
  },
};
