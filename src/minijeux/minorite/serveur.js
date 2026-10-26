/**
 * Mini-jeu : LA MINORITÉ GAGNE
 * Choix entre A et B ; seuls ceux qui ont choisi l'option la MOINS choisie survivent.
 * - Égalité parfaite : tout le monde passe.
 * - Tout le monde a choisi la même option : personne n'est en minorité -> tour rejoué.
 * - À 2 joueurs, ce jeu ne peut plus départager : mort subite automatique.
 *
 * Options A / B de chaque tour, par ordre de priorité :
 *   1. modifiées par l'organisateur pendant la partie pour le prochain tour (commandeOrganisateur) ;
 *   2. liste préparée à la création (« Pizza / Burger », une ligne par tour, reprise au début si épuisée) ;
 *   3. options A et B par défaut.
 */
const { ErreurJeu } = require('../../moteur/outils');

const MAX_TEXTE = 30;
const MAX_LIGNES = 50;

/** « Pizza / Burger » (ou « Pizza | Burger », « Pizza ; Burger ») -> { a, b } ; null si la ligne est vide. */
function lireLigne(ligne, numero) {
  const l = ligne.trim();
  if (!l) return null;
  const parts = l.split(/\s*[/|;]\s*/).map((x) => x.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ErreurJeu(`Options par tour, ligne ${numero} : écris deux options séparées par « / » (ex. « Pizza / Burger »).`);
  }
  if (parts.some((p) => p.length > MAX_TEXTE)) throw new ErreurJeu(`Options par tour, ligne ${numero} : ${MAX_TEXTE} caractères maximum par option.`);
  return { a: parts[0], b: parts[1] };
}

function lireListe(texte) {
  const lignes = String(texte || '').split(/\r?\n/).map((l, i) => lireLigne(l, i + 1)).filter(Boolean);
  if (lignes.length > MAX_LIGNES) throw new ErreurJeu(`Options par tour : ${MAX_LIGNES} lignes maximum.`);
  return lignes;
}

/** Options prévues pour un tour donné. */
function optionsDuTour(params, tour, reglages) {
  if (reglages?.pourTour === tour && reglages.a && reglages.b) return { a: reglages.a, b: reglages.b };
  const liste = lireListe(params.optionsParTour);
  if (liste.length) return liste[(tour - 1) % liste.length];
  return { a: params.optionA || 'A', b: params.optionB || 'B' };
}

module.exports = {
  id: 'minorite',
  ordre: 3,
  nom: 'La minorité gagne',
  icone: '⚖️',
  description: 'Choisis A ou B : seuls ceux qui ont choisi l\'option la moins populaire survivent. Idéal pour réduire vite un grand groupe.',
  dureeTourDefaut: 15,
  parametres: [
    { cle: 'optionA', libelle: 'Texte de l\'option A', type: 'texte', defaut: 'A', max: MAX_TEXTE },
    { cle: 'optionB', libelle: 'Texte de l\'option B', type: 'texte', defaut: 'B', max: MAX_TEXTE },
    {
      cle: 'optionsParTour', libelle: 'Options par tour (facultatif)', type: 'texte', defaut: '', max: 3000, multiligne: true,
      placeholder: 'Pizza / Burger\nMer / Montagne\nChat / Chien',
      aide: 'Une ligne par tour : « option A / option B ». Tour 1 = ligne 1, tour 2 = ligne 2… (on reprend au début si la liste est épuisée). Vide = options A et B ci-dessus. Tu pourras aussi les changer entre deux tours.',
    },
  ],
  optionsDuTour,

  validerParametres(params) { lireListe(params.optionsParTour); },

  async initialiser({ params, reglages }) { return optionsDuTour(params, 1, reglages); },
  async debutTour({ etat, tour, params, reglages }) {
    const { a, b } = optionsDuTour(params, tour, reglages);
    return { etat: { ...etat, a, b }, public: { consigne: 'Choisis l\'option que la MINORITÉ va choisir…', a, b } };
  },

  /** L'organisateur change les options du prochain tour (en salle d'attente ou entre deux tours). */
  commandeOrganisateur({ donnees, prochainTour }) {
    const a = String(donnees?.a || '').trim();
    const b = String(donnees?.b || '').trim();
    if (!a || !b) throw new ErreurJeu('Remplis les deux options.');
    if (a.length > MAX_TEXTE || b.length > MAX_TEXTE) throw new ErreurJeu(`${MAX_TEXTE} caractères maximum par option.`);
    if (a.toLowerCase() === b.toLowerCase()) throw new ErreurJeu('Les deux options doivent être différentes.');
    return { a, b, pourTour: prochainTour };
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
