/**
 * Mini-jeu : MÉMOIRE (type Simon)
 * Une séquence de couleurs s'allume ; il faut la reproduire. Elle s'allonge d'une couleur à chaque tour.
 * Erreur ou pas de réponse = éliminé.
 */
const { ErreurJeu } = require('../../moteur/outils');

const COULEURS = ['rouge', 'vert', 'bleu', 'jaune'];

module.exports = {
  id: 'memoire',
  ordre: 14,
  nom: 'Mémoire',
  icone: '🧠',
  description: 'Mémorise la séquence de couleurs puis reproduis-la. Elle s\'allonge à chaque tour. Une erreur = éliminé.',
  dureeTourDefaut: 20,
  parametres: [
    { cle: 'longueurDepart', libelle: 'Longueur de la première séquence', type: 'nombre', min: 2, max: 10, defaut: 3 },
    { cle: 'vitesse', libelle: 'Durée d\'un flash (ms)', type: 'nombre', min: 250, max: 1500, defaut: 650, aide: 'Plus petit = plus difficile.' },
  ],

  async initialiser({ params, rng }) {
    return { sequence: Array.from({ length: params.longueurDepart - 1 }, () => rng.choisir(COULEURS)) };
  },

  async debutTour({ etat, essai, params, rng }) {
    // la séquence s'allonge d'une couleur (sauf si le tour est rejoué)
    const sequence = essai === 0 ? [...etat.sequence, rng.choisir(COULEURS)] : etat.sequence;
    const pas = params.vitesse;
    const debut = 1500;
    const evenements = sequence.map((couleur, i) => ({ dansMs: debut + i * (pas + 200), type: 'flash', donnees: { couleur, i, duree: pas } }));
    const finAffichage = debut + sequence.length * (pas + 200);
    evenements.push({ dansMs: finAffichage, type: 'atoi', donnees: { longueur: sequence.length } });
    return {
      etat: { ...etat, sequence },
      public: { consigne: `Mémorise la séquence de ${sequence.length} couleurs…`, longueur: sequence.length },
      evenements,
      dureeMs: finAffichage + params.dureeTour * 1000,
    };
  },

  action({ etat, donnees }) {
    const s = donnees.sequence;
    if (!Array.isArray(s) || s.length !== etat.sequence.length || !s.every((c) => COULEURS.includes(c))) throw new ErreurJeu('Séquence incomplète.');
    const juste = s.every((c, i) => c === etat.sequence[i]);
    return { enregistrer: { juste }, public: null, prive: { juste } };
  },

  async resoudreTour({ etat, actions }) {
    const survivants = Object.entries(actions).filter(([, a]) => a.juste).map(([id]) => id);
    return { etat, survivants, details: { type: 'memoire', sequence: etat.sequence, justes: survivants.length, faux: Object.keys(actions).length - survivants.length } };
  },
};
