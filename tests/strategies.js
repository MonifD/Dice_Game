/**
 * Comportement des bots du test de charge pour chaque mini-jeu.
 * jouer({ etat, moi, envoyer }) est appelé une fois par tour pour chaque bot encore en jeu.
 * surEvenement({ ev, ... }) reçoit les événements programmés (feu vert, flashs…).
 */
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const hasard = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const choisir = (t) => t[Math.floor(Math.random() * t.length)];
const delai = () => attendre(hasard(100, 2500));

/** Cliqueur : envoie des paquets de clics toutes les 250 ms pendant `dureeMs`. */
async function cliquer(envoyer, cle, dureeMs, parSeconde) {
  const fin = Date.now() + dureeMs;
  while (Date.now() < fin) {
    await attendre(250);
    const r = await envoyer({ [cle]: Math.max(1, Math.round((parSeconde * 250) / 1000)) });
    if (!r.ok || r.fini) return;
  }
}

// état partagé par les bots d'un même processus pour les jeux à événements
const feux = new Map(); // moi -> couleur actuelle
const sequences = new Map(); // moi -> couleurs vues

module.exports = {
  des: { params: { nombreCible: 6 }, async jouer({ envoyer }) { await delai(); await envoyer({}); } },

  'pile-ou-face': { async jouer({ envoyer }) { await delai(); await envoyer({ choix: choisir(['pile', 'face']) }); } },

  minorite: { async jouer({ envoyer }) { await delai(); await envoyer({ choix: Math.random() < 0.45 ? 'A' : 'B' }); } },

  'nombre-mystere': { async jouer({ envoyer }) { await delai(); await envoyer({ nombre: hasard(1, 100) }); } },

  'pierre-feuille-ciseaux': { async jouer({ envoyer }) { await delai(); await envoyer({ coup: choisir(['pierre', 'feuille', 'ciseaux']) }); } },

  'carte-haute': { async jouer({ envoyer }) { await delai(); await envoyer({}); } },

  portes: { params: { nbPortes: 3 }, async jouer({ envoyer }) { await delai(); await envoyer({ porte: hasard(1, 3) }); } },

  reflexe: {
    absents: 0.01,
    async jouer() { /* on attend l'événement « vert » */ },
    surEvenement({ ev, s, code, emettre }) {
      if (ev.type !== 'vert') return;
      const tropTot = Math.random() < 0.03;
      setTimeout(() => emettre(s, 'jeu:action', { code, donnees: {} }), tropTot ? 0 : hasard(180, 700));
    },
  },

  'feu-rouge': {
    params: { dureeTour: 10 },
    async jouer({ etat, moi, envoyer }) {
      const fin = etat.tourCourant.finMs - 300;
      while (Date.now() < fin) {
        await attendre(220);
        const couleur = feux.get(moi);
        const imprudent = Math.random() < 0.01;
        if (couleur === 'vert' || imprudent) {
          const r = await envoyer({ pas: hasard(1, 3) });
          if (!r.ok || r.fini) return;
        }
      }
    },
    surEvenement({ ev, moi }) { if (ev.type === 'feu') feux.set(moi, ev.donnees.couleur); },
  },

  'course-clics': {
    params: { dureeTour: 5 },
    async jouer({ envoyer }) { await attendre(3100); await cliquer(envoyer, 'clics', 5000, hasard(4, 12)); },
  },

  quiz: { async jouer({ etat, envoyer }) { await delai(); await envoyer({ reponse: Math.random() < 0.7 ? 0 : hasard(0, etat.tourCourant.public.choix.length - 1) }); } },

  'juste-prix': { async jouer({ etat, envoyer }) { await delai(); const p = etat.tourCourant.public; await envoyer({ estimation: hasard(p.min, p.max) }); } },

  'calcul-mental': {
    async jouer({ etat, envoyer }) {
      await delai();
      // les bots « calculent » l'expression (avec 10 % d'erreurs)
      const expr = etat.tourCourant.public.expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/(\d+)²/g, '$1*$1');
      // eslint-disable-next-line no-new-func
      const juste = Function(`return (${expr})`)();
      await envoyer({ reponse: Math.random() < 0.9 ? juste : juste + 1 });
    },
  },

  memoire: {
    params: { vitesse: 300 },
    async jouer({ etat, moi, envoyer }) {
      const tc = etat.tourCourant;
      sequences.set(moi, []);
      await attendre(Math.max(0, tc.debutMs + 1500 + tc.public.longueur * 500 + 300 - Date.now())); // fin de l'affichage
      const vue = sequences.get(moi) || [];
      const s = vue.length === tc.public.longueur ? vue : Array.from({ length: tc.public.longueur }, () => 'rouge');
      await envoyer({ sequence: Math.random() < 0.85 ? s : [...s].reverse() });
    },
    surEvenement({ ev, moi }) { if (ev.type === 'flash') { const v = sequences.get(moi) || []; v[ev.donnees.i] = ev.donnees.couleur; sequences.set(moi, v); } },
  },

  roue: { params: { dureeRotation: 3 }, async jouer() {} },

  encheres: {
    params: { elimination: '50' },
    async jouer({ etat, moi, envoyer }) { await delai(); const pts = etat.vue?.points?.[moi] ?? 0; await envoyer({ mise: hasard(0, Math.min(pts, 40)) }); },
  },
};
