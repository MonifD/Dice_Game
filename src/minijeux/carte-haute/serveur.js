/**
 * Mini-jeu : LA CARTE LA PLUS HAUTE
 * Chaque joueur tire une carte (tirage serveur). Les plus basses sont éliminées.
 * Valeur : 2 < … < 10 < V < D < R < As ; à valeur égale, ♣ < ♦ < ♥ < ♠ si l'option « couleurs » est active.
 *
 * Les cartes restent cachées pendant le tour (chacun ne voit que la sienne). À l'écran des résultats,
 * elles sont toutes retournées une à une (de la plus basse à la plus haute), puis la meilleure est
 * mise en valeur : details.revelationMs indique au moteur la durée de cette animation.
 */
const { garderMeilleurs } = require('../../moteur/outils');

const VALEURS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R', 'A'];
const NOMS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Valet', 'Dame', 'Roi', 'As'];
const COULEURS = ['♣', '♦', '♥', '♠'];

/** Durées de l'animation de révélation (partagées avec client.js via details). */
function tempsRevelation(n) {
  const pasMs = Math.round(Math.min(350, Math.max(50, 3500 / Math.max(1, n))));
  const miseEnValeurMs = 1500;
  return { pasMs, miseEnValeurMs, revelationMs: n * pasMs + 600 + miseEnValeurMs };
}

const libelle = (c, couleurs) => (couleurs ? `${c.valeur}${c.couleur}` : NOMS[VALEURS.indexOf(c.valeur)]);

module.exports = {
  id: 'carte-haute',
  ordre: 6,
  nom: 'La carte la plus haute',
  icone: '🃏',
  description: 'Chaque joueur tire une carte au hasard. Toutes les cartes sont révélées à la fin du tour : les plus basses sont éliminées.',
  dureeTourDefaut: 15,
  parametres: [
    { cle: 'pourcentElimines', libelle: '% de joueurs éliminés par tour', type: 'nombre', min: 10, max: 90, defaut: 50 },
    { cle: 'couleurs', libelle: 'Les couleurs départagent (♣ < ♦ < ♥ < ♠)', type: 'booleen', defaut: false },
  ],

  async initialiser() { return {}; },
  async debutTour({ etat }) { return { etat, public: { consigne: 'Tire ta carte ! Elles seront toutes révélées à la fin du tour.' } }; },

  action({ rng, params }) {
    const v = rng.entier(0, VALEURS.length - 1);
    const c = rng.entier(0, COULEURS.length - 1);
    const carte = { valeur: VALEURS[v], couleur: COULEURS[c], score: params.couleurs ? v * 4 + c : v };
    // public: null -> les autres ne voient pas la carte avant les résultats
    return { enregistrer: carte, public: null, prive: carte };
  },

  async resoudreTour({ etat, actions, params }) {
    const lignes = Object.entries(actions).map(([joueurId, c]) => ({ joueurId, ...c })).sort((a, b) => b.score - a.score);
    const survivants = garderMeilleurs(lignes.map((l) => ({ id: l.joueurId, score: l.score })), params.pourcentElimines);
    const gardes = new Set(survivants);

    let message = null;
    if (lignes.length) {
      const meilleure = lignes[0];
      const exAequo = lignes.filter((l) => l.score === meilleure.score).length;
      const seuil = lignes.filter((l) => gardes.has(l.joueurId)).at(-1);
      message = `👑 Carte la plus haute : ${libelle(meilleure, true)}${exAequo > 1 ? ` (${exAequo} joueurs à égalité)` : ''}.`;
      if (survivants.length === lignes.length) message += ' Tout le monde a la même carte : tous passent.';
      else if (survivants.length > 1) message += ` Il fallait au moins ${params.couleurs ? `un ${libelle(seuil, true)}` : `un ${libelle(seuil, false)}`} pour passer.`;
    }
    return {
      etat, survivants, message,
      details: { type: 'carte-haute', lignes, ...tempsRevelation(lignes.length) },
    };
  },
};
