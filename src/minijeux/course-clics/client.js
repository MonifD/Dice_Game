/* Affichage : Course de clics */
(function () {
  let paquet = 0;
  let total = 0;
  let envoi = null;
  let rebours = null;

  LW.miniJeux['course-clics'] = {
    monter(zone, ctx) {
      paquet = 0; total = 0;
      zone.innerHTML = `<div class="grand-texte" id="cc-total">${ctx.peutJouer ? '3' : '👀'}</div>
        ${ctx.peutJouer ? '<button class="btn principal" id="cc-btn" disabled style="width:100%;max-width:420px;min-height:140px;font-size:1.8rem;touch-action:manipulation">Attends…</button>' : '<div class="muet">Les scores seront révélés à la fin.</div>'}`;
      const btn = zone.querySelector('#cc-btn');
      if (!btn) return;
      const affiche = zone.querySelector('#cc-total');
      const depart = ctx.tour.debutMs + ctx.public.departMs;
      rebours = setInterval(() => {
        const reste = depart - ctx.maintenant();
        if (reste > 0) { affiche.textContent = Math.ceil(reste / 1000); return; }
        clearInterval(rebours);
        demarrer();
      }, 100);
      function demarrer() {
        if (!btn.disabled) return;
        btn.disabled = false;
        btn.textContent = '👆 CLIQUE !';
        affiche.textContent = '0';
      }
      this._demarrer = demarrer;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (btn.disabled) return;
        paquet++; total++;
        affiche.textContent = total;
      });
      envoi = setInterval(async () => {
        if (!paquet) return;
        if (ctx.maintenant() > ctx.tour.finMs) { btn.disabled = true; btn.textContent = 'Terminé !'; return; }
        const n = paquet; paquet = 0;
        await ctx.agir({ clics: n });
      }, 250);
    },
    surEvenement(zone, ctx, ev) { if (ev.type === 'go') this._demarrer?.(); },
    demonter() { clearInterval(envoi); clearInterval(rebours); this._demarrer = null; },
    resultat(zone, d, ctx) {
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      zone.innerHTML = '';
      LW.ui.classement(zone, d.lignes.map((l) => ({ joueurId: l.joueurId, valeur: l.clics, texte: `${l.clics}`, ok: survivants.has(l.joueurId) })), ctx);
    },
  };
})();
