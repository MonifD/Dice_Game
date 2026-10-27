/**
 * Mini-jeu : LES PORTES
 * Chaque joueur choisit une porte. À la fin du tour, le serveur révèle la ou les portes piégées :
 * ceux qui les ont choisies sont éliminés.
 */
const { ErreurJeu } = require('../../moteur/outils');

module.exports = {
  id: 'portes',
  ordre: 7,
  nom: 'Les portes',
  icone: '🚪',
  description: 'Choisis une porte parmi plusieurs. Une porte est piégée : ceux qui l\'ont choisie sont éliminés.',
  /** Règles affichées en salle d'attente (p = paramètres de la partie). */
  regles: (p) => [
    `Choisis une porte parmi ${p.nbPortes}.`,
    `${p.nbPiegees > 1 ? `${p.nbPiegees} portes sont piégées` : 'Une porte est piégée'} : le serveur la révèle à la fin du tour, ceux qui l'ont choisie sont éliminés.`,
    p.voirChoix ? 'Tu vois en direct combien de joueurs sont derrière chaque porte.' : 'Les choix des autres restent secrets.',
  ],
  dureeTourDefaut: 15,
  parametres: [
    { cle: 'nbPortes', libelle: 'Nombre de portes', type: 'nombre', min: 2, max: 8, defaut: 3 },
    { cle: 'nbPiegees', libelle: 'Nombre de portes piégées', type: 'nombre', min: 1, max: 7, defaut: 1 },
    { cle: 'voirChoix', libelle: 'Montrer en direct combien de joueurs sont derrière chaque porte', type: 'booleen', defaut: true },
  ],
  validerParametres(p) {
    if (p.nbPiegees >= p.nbPortes) throw new ErreurJeu('Il faut au moins une porte sans piège.');
  },

  async initialiser({ params }) { return { nbPortes: params.nbPortes, nbPiegees: params.nbPiegees }; },
  async debutTour({ etat, params }) {
    return { etat, public: { consigne: `Choisis une porte… ${etat.nbPiegees > 1 ? `${etat.nbPiegees} sont piégées` : 'une est piégée'} !`, nbPortes: etat.nbPortes, voirChoix: params.voirChoix } };
  },

  action({ etat, donnees, params }) {
    const p = Number(donnees.porte);
    if (!Number.isInteger(p) || p < 1 || p > etat.nbPortes) throw new ErreurJeu('Porte invalide.');
    return { enregistrer: { porte: p }, public: params.voirChoix ? { porte: p } : null, prive: { porte: p } };
  },

  async resoudreTour({ etat, actions, rng }) {
    const toutes = Array.from({ length: etat.nbPortes }, (_, i) => i + 1);
    const piegees = rng.echantillon(toutes, etat.nbPiegees).sort((a, b) => a - b);
    const compte = Object.fromEntries(toutes.map((p) => [p, 0]));
    const survivants = [];
    for (const [id, a] of Object.entries(actions)) {
      compte[a.porte]++;
      if (!piegees.includes(a.porte)) survivants.push(id);
    }
    return {
      etat, survivants,
      message: `Porte${piegees.length > 1 ? 's' : ''} piégée${piegees.length > 1 ? 's' : ''} : ${piegees.join(', ')} 💥`,
      details: { type: 'portes', piegees, compte },
    };
  },
};
