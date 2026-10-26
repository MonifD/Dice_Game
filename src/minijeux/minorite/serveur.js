/**
 * Mini-jeu : LA MINORITÉ GAGNE
 * Choix entre A et B ; seuls ceux qui ont choisi l'option la MOINS choisie survivent.
 * - Égalité parfaite : tout le monde passe.
 * - Tout le monde a choisi la même option : personne n'est en minorité -> tour rejoué.
 * - À 2 joueurs, ce jeu ne peut plus départager : mort subite automatique.
 */
const { ErreurJeu } = require('../../moteur/outils');

module.exports = {
  id: 'minorite',
  ordre: 3,
  nom: 'La minorité gagne',
  icone: '⚖️',
  description: 'Choisis A ou B : seuls ceux qui ont choisi l\'option la moins populaire survivent. Idéal pour réduire vite un grand groupe.',
  dureeTourDefaut: 15,
  parametres: [
    { cle: 'optionA', libelle: 'Texte de l\'option A', type: 'texte', defaut: 'A', max: 30 },
    { cle: 'optionB', libelle: 'Texte de l\'option B', type: 'texte', defaut: 'B', max: 30 },
  ],

  async initialiser({ params }) { return { a: params.optionA || 'A', b: params.optionB || 'B' }; },
  async debutTour({ etat }) {
    return { etat, public: { consigne: 'Choisis l\'option que la MINORITÉ va choisir…', a: etat.a, b: etat.b } };
  },

  action({ donnees }) {
    if (!['A', 'B'].includes(donnees.choix)) throw new ErreurJeu('Choisis A ou B.');
    return { enregistrer: { choix: donnees.choix }, public: null, prive: { choix: donnees.choix } };
  },

  async resoudreTour({ etat, actions }) {
    const ids = { A: [], B: [] };
    for (const [id, a] of Object.entries(actions)) ids[a.choix].push(id);
    const nA = ids.A.length;
    const nB = ids.B.length;
    let survivants;
    let message;
    if (nA === nB) { survivants = [...ids.A, ...ids.B]; message = 'Égalité parfaite : tout le monde passe !'; }
    else if (nA === 0 || nB === 0) { survivants = []; message = null; }
    else {
      const min = nA < nB ? 'A' : 'B';
      survivants = ids[min];
      message = `La minorité a choisi « ${min === 'A' ? etat.a : etat.b} » (${ids[min].length} contre ${Math.max(nA, nB)}).`;
    }
    return { etat, survivants, message, details: { type: 'minorite', a: etat.a, b: etat.b, nA, nB } };
  },

  estTermine({ enJeu }) { return enJeu.length <= 2; },
};
