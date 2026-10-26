/**
 * Mini-jeu : NOMBRE MYSTÈRE
 * Chacun propose un nombre ; le serveur tire le nombre mystère à la fin du tour.
 * La moitié la plus éloignée (pourcentage réglable) est éliminée.
 */
const { ErreurJeu, garderMeilleurs } = require('../../moteur/outils');

module.exports = {
  id: 'nombre-mystere',
  ordre: 4,
  nom: 'Nombre mystère',
  icone: '🔢',
  description: 'Propose un nombre entre 1 et 100. Le serveur tire le nombre mystère : les plus éloignés sont éliminés.',
  dureeTourDefaut: 20,
  parametres: [
    { cle: 'max', libelle: 'Nombre maximum', type: 'nombre', min: 10, max: 1000, defaut: 100 },
    { cle: 'pourcentElimines', libelle: '% de joueurs éliminés par tour', type: 'nombre', min: 10, max: 90, defaut: 50 },
  ],

  async initialiser({ params }) { return { max: params.max }; },
  async debutTour({ etat }) {
    return { etat, public: { consigne: `Propose un nombre entre 1 et ${etat.max}`, max: etat.max } };
  },

  action({ etat, donnees }) {
    const n = Number(donnees.nombre);
    if (!Number.isInteger(n) || n < 1 || n > etat.max) throw new ErreurJeu(`Nombre entier entre 1 et ${etat.max}.`);
    return { enregistrer: { nombre: n }, public: null, prive: { nombre: n } };
  },

  async resoudreTour({ etat, actions, params, rng }) {
    const mystere = rng.entier(1, etat.max);
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, nombre: a.nombre, ecart: Math.abs(a.nombre - mystere) }));
    const survivants = garderMeilleurs(lignes.map((l) => ({ id: l.joueurId, score: -l.ecart })), params.pourcentElimines);
    return {
      etat, survivants,
      message: `Le nombre mystère était ${mystere} !`,
      details: { type: 'nombre-mystere', mystere, max: etat.max, lignes: lignes.sort((a, b) => a.ecart - b.ecart) },
    };
  },
};
