/* Affichage : Réflexe — un grand bouton rouge qui passe au vert */
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .zone-reflexe { width: 100%; min-height: 260px; border-radius: 16px; display: grid; place-items: center; text-align: center;
      font: 800 clamp(1.6rem, 6vw, 2.6rem) var(--titre); cursor: pointer; user-select: none; touch-action: manipulation;
      background: #a12a2a; color: #fff; border: none; transition: background .05s; }
    .zone-reflexe.vert { background: #23a35a; }
    .zone-reflexe.fini { background: var(--panneau-2); color: var(--texte); cursor: default; }`;
  document.head.appendChild(style);

  let el = null;
  let vert = false;
  LW.miniJeux.reflexe = {
    formater: (p) => (p.tropTot ? 'trop tôt ❌' : `${p.tempsMs} ms`),
    monter(zone, ctx) {
      vert = false;
      const deja = ctx.monAction?.public;
      zone.innerHTML = `<button class="zone-reflexe ${deja ? 'fini' : ''}" id="reflexe">${deja ? texte(deja) : ctx.peutJouer ? 'Attends le vert…' : '👀 Spectateur'}</button>`;
      el = zone.querySelector('#reflexe');
      if (!ctx.peutJouer || deja) { el.disabled = true; return; }
      // pointerdown : plus réactif que click sur mobile
      el.addEventListener('pointerdown', async () => {
        if (el.disabled) return;
        el.disabled = true;
        const rep = await ctx.agir({});
        el.classList.add('fini');
        el.classList.remove('vert');
        el.textContent = rep.ok ? texte(rep.prive) : rep.erreur;
      }, { once: false });
    },
    surEvenement(zone, ctx, ev) {
      if (ev.type !== 'vert' || !el) return;
      vert = true;
      if (!el.classList.contains('fini')) { el.classList.add('vert'); el.textContent = ctx.peutJouer ? 'CLIQUE !' : 'VERT !'; }
    },
    demonter() { el = null; },
    resultat(zone, d, ctx) {
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      zone.innerHTML = d.tropTot ? `<div class="muet">${d.tropTot} joueur(s) ont cliqué trop tôt.</div>` : '';
      const max = Math.max(1, ...d.lignes.map((l) => l.tempsMs));
      LW.ui.classement(zone, d.lignes.map((l) => ({ joueurId: l.joueurId, valeur: max - l.tempsMs + 30, texte: `${l.tempsMs} ms`, ok: survivants.has(l.joueurId) })), ctx, { max: max + 30 });
    },
  };
  function texte(p) { return p.tropTot ? '❌ Trop tôt !' : `⚡ ${p.tempsMs} ms`; }
})();
