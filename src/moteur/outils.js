/**
 * Outils partagés par le moteur et les mini-jeux :
 *  - rng : tirages au sort CRYPTOGRAPHIQUES, faits uniquement côté serveur ;
 *  - ErreurJeu : erreur « normale » renvoyée telle quelle au joueur.
 */
const crypto = require('crypto');

class ErreurJeu extends Error {
  constructor(message) { super(message); this.estErreurJeu = true; }
}

const rng = {
  /** Entier uniforme dans [min, max] (bornes incluses). */
  entier(min, max) { return crypto.randomInt(min, max + 1); },
  /** Réel uniforme dans [0, 1[. */
  reel() { return crypto.randomInt(0, 2 ** 48 - 1) / 2 ** 48; },
  /** Élément au hasard d'un tableau. */
  choisir(tab) { return tab[crypto.randomInt(0, tab.length)]; },
  /** Copie mélangée (Fisher-Yates). */
  melanger(tab) {
    const t = [...tab];
    for (let i = t.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [t[i], t[j]] = [t[j], t[i]];
    }
    return t;
  },
  /** k éléments distincts au hasard. */
  echantillon(tab, k) { return this.melanger(tab).slice(0, k); },
};

/**
 * Garde les joueurs dont le score est « le meilleur », en éliminant une proportion.
 * Utilisé par plusieurs mini-jeux (« la moitié la plus basse est éliminée »…).
 *
 * @param {Array<{id, score}>} liste  score : plus grand = meilleur
 * @param {number} pourcentElimines  0..100
 * @returns {string[]} ids des survivants. Les ex aequo à la limite survivent ensemble
 *                    (on n'élimine jamais au hasard entre deux scores identiques).
 *                    Garantit au moins 1 survivant et, si possible, au moins 1 éliminé.
 *                    Finale toujours en duel : tant qu'il reste plus de 2 joueurs, au moins 2 passent
 *                    (on ne passe jamais de 3 joueurs ou plus à un seul gagnant en un tour).
 */
function garderMeilleurs(liste, pourcentElimines) {
  if (liste.length <= 1) return liste.map((x) => x.id);
  const tries = [...liste].sort((a, b) => b.score - a.score);
  const minGardes = tries.length > 2 ? 2 : 1;
  let nbGardes = Math.max(minGardes, Math.round(tries.length * (1 - pourcentElimines / 100)));
  if (nbGardes >= tries.length) nbGardes = tries.length - 1; // au moins un éliminé par tour
  const seuil = tries[nbGardes - 1].score;
  let gardes = tries.filter((x) => x.score >= seuil);
  // Si les ex aequo font que tout le monde survit, on élimine quand même les strictement plus bas,
  // à condition qu'il en reste assez (sinon tous passent, le tour suivant départagera).
  if (gardes.length === tries.length) {
    const min = tries[tries.length - 1].score;
    const auDessus = tries.filter((x) => x.score > min);
    if (auDessus.length >= minGardes) gardes = auDessus;
  }
  return gardes.map((x) => x.id);
}

module.exports = { ErreurJeu, rng, garderMeilleurs };
