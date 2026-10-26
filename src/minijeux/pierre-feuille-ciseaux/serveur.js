/**
 * Mini-jeu : PIERRE-FEUILLE-CISEAUX CONTRE LE SERVEUR
 * Chaque joueur affronte le serveur, qui tire son coup au hasard au moment où le joueur joue.
 * Perdu = éliminé ; égalité ou victoire = on continue au tour suivant.
 */
const { ErreurJeu } = require('../../moteur/outils');

const BAT = { pierre: 'ciseaux', feuille: 'pierre', ciseaux: 'feuille' };

module.exports = {
  id: 'pierre-feuille-ciseaux',
  ordre: 5,
  nom: 'Pierre-feuille-ciseaux',
  icone: '✊',
  description: 'Affronte le serveur ! Ceux qui perdent sont éliminés, les égalités rejouent au tour suivant.',
  dureeTourDefaut: 15,
  parametres: [
    {
      cle: 'mode', libelle: 'Coup du serveur', type: 'choix', defaut: 'individuel',
      options: [{ valeur: 'individuel', libelle: 'Un coup différent pour chaque joueur' }, { valeur: 'commun', libelle: 'Le même coup pour tous (révélé à la fin)' }],
    },
  ],

  async initialiser() { return {}; },
  async debutTour({ etat, params, rng }) {
    const coupCommun = params.mode === 'commun' ? rng.choisir(Object.keys(BAT)) : null; // reste secret côté serveur
    return { etat: { ...etat, coupCommun }, public: { consigne: 'Pierre, feuille ou ciseaux ?', mode: params.mode } };
  },

  action({ etat, donnees, rng }) {
    const coup = donnees.coup;
    if (!BAT[coup]) throw new ErreurJeu('Choisis pierre, feuille ou ciseaux.');
    if (etat.coupCommun) return { enregistrer: { coup }, public: null, prive: { coup } };
    const serveur = rng.choisir(Object.keys(BAT));
    const issue = coup === serveur ? 'egalite' : BAT[coup] === serveur ? 'gagne' : 'perdu';
    return { enregistrer: { coup, serveur, issue }, public: { coup, serveur, issue }, prive: { coup, serveur, issue } };
  },

  async resoudreTour({ etat, actions }) {
    const lignes = Object.entries(actions).map(([joueurId, a]) => {
      if (!etat.coupCommun) return { joueurId, ...a };
      const serveur = etat.coupCommun;
      return { joueurId, coup: a.coup, serveur, issue: a.coup === serveur ? 'egalite' : BAT[a.coup] === serveur ? 'gagne' : 'perdu' };
    });
    const compte = (i) => lignes.filter((l) => l.issue === i).length;
    return {
      etat,
      survivants: lignes.filter((l) => l.issue !== 'perdu').map((l) => l.joueurId),
      message: etat.coupCommun ? `Le serveur a joué ${etat.coupCommun.toUpperCase()}.` : null,
      details: { type: 'pfc', serveur: etat.coupCommun, gagne: compte('gagne'), egalite: compte('egalite'), perdu: compte('perdu') },
    };
  },
};
