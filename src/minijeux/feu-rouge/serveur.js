/**
 * Mini-jeu : FEU ROUGE, FEU VERT
 * Le serveur prépare en secret une suite de feux verts/rouges et les annonce en direct.
 * Chaque clic fait avancer d'un pas — seulement au vert ! Cliquer au rouge = éliminé.
 * À la fin du temps, les plus avancés passent.
 *
 * Le navigateur envoie ses clics par petits paquets ({ pas: n } toutes les ~200 ms) ;
 * le serveur vérifie l'état du feu à la RÉCEPTION et plafonne la cadence (anti auto-clic).
 */
const { ErreurJeu } = require('../../moteur/outils');

const GRACE_ROUGE_MS = 350; // tolérance réseau juste après le passage au rouge
const CLICS_MAX_PAR_S = 12;

/** Couleur du feu à un instant donné (ms depuis le début du tour). */
function feuA(feux, ms) {
  let courant = feux[0];
  for (const f of feux) { if (f.dansMs <= ms) courant = f; else break; }
  return courant;
}

module.exports = {
  id: 'feu-rouge',
  ordre: 9,
  nom: 'Feu rouge, feu vert',
  icone: '🚦',
  description: 'Clique pour avancer seulement quand le feu est VERT. Un clic au rouge = éliminé. Les plus avancés à la fin passent.',
  /** Règles affichées en salle d'attente (p = paramètres de la partie). */
  regles: (p) => [
    'Clique sur « Avancer » pour faire un pas, mais SEULEMENT quand le feu est VERT.',
    'Un clic quand le feu est ROUGE = éliminé !',
    `À la fin du temps, les ${p.pourcentElimines} % les moins avancés sont éliminés.`,
  ],
  dureeTourDefaut: 20,
  parametres: [
    { cle: 'pourcentElimines', libelle: '% des moins avancés éliminés', type: 'nombre', min: 10, max: 90, defaut: 50 },
  ],

  async initialiser() { return {}; },
  async debutTour({ etat, params, rng }) {
    const dureeMs = params.dureeTour * 1000;
    const feux = [{ dansMs: 0, couleur: 'rouge' }];
    let t = rng.entier(1200, 2500);
    let couleur = 'vert';
    while (t < dureeMs - 500) {
      feux.push({ dansMs: t, couleur });
      t += couleur === 'vert' ? rng.entier(1200, 4000) : rng.entier(900, 3000);
      couleur = couleur === 'vert' ? 'rouge' : 'vert';
    }
    return {
      etat: { ...etat, feux },
      public: { consigne: 'Avance au VERT, stop au ROUGE !' },
      evenements: feux.map((f) => ({ dansMs: f.dansMs, type: 'feu', donnees: { couleur: f.couleur } })),
    };
  },

  action({ etat, donnees, precedent, ecouleMs }) {
    if (precedent?.attrape) throw new ErreurJeu('Tu as été pris au rouge.');
    const n = Math.floor(Number(donnees.pas));
    if (!Number.isFinite(n) || n < 1 || n > 30) throw new ErreurJeu('Paquet de clics invalide.');
    const feu = feuA(etat.feux, ecouleMs);
    const depuisChangement = ecouleMs - feu.dansMs;
    const etaitVertJuste = feu.couleur === 'rouge' && depuisChangement <= GRACE_ROUGE_MS && feu.dansMs > 0;
    if (feu.couleur === 'rouge' && !etaitVertJuste) {
      const r = { pas: precedent?.pas || 0, attrape: true, dernierMs: ecouleMs };
      return { enregistrer: r, fini: true, public: { attrape: true, pas: r.pas }, prive: r };
    }
    // plafond de cadence : pas plus de CLICS_MAX_PAR_S depuis le dernier paquet
    const dernier = precedent?.dernierMs ?? 0;
    const plafond = Math.ceil(((ecouleMs - dernier) / 1000) * CLICS_MAX_PAR_S) + 2;
    const pas = (precedent?.pas || 0) + Math.min(n, plafond);
    return { enregistrer: { pas, dernierMs: ecouleMs }, fini: false, public: null, prive: { pas } };
  },

  async resoudreTour({ etat, actions, params }) {
    const { garderMeilleurs } = require('../../moteur/outils');
    const lignes = Object.entries(actions).map(([joueurId, a]) => ({ joueurId, pas: a.pas || 0, attrape: !!a.attrape }));
    const libres = lignes.filter((l) => !l.attrape && l.pas > 0);
    const survivants = garderMeilleurs(libres.map((l) => ({ id: l.joueurId, score: l.pas })), params.pourcentElimines);
    return {
      etat, survivants,
      details: { type: 'feu-rouge', attrapes: lignes.filter((l) => l.attrape).length, lignes: lignes.sort((a, b) => (a.attrape - b.attrape) || b.pas - a.pas) },
    };
  },
};
