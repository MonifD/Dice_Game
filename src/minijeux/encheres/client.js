/* Affichage : Enchères à l'aveugle */
(function () {
  LW.miniJeux.encheres = {
    monter(zone, ctx) {
      const pts = ctx.vue?.points?.[String(ctx.moi.id)];
      zone.innerHTML = pts !== undefined
        ? `<div class="muet">Ton budget</div><div class="grand-texte" style="color:var(--accent-2)">💎 ${pts}</div>`
        : '<div style="font-size:64px">💎</div>';
      if (pts === undefined) return;
      LW.ui.saisieNombre(zone, ctx, {
        min: 0, max: pts, placeholder: `Mise (0 à ${pts})`, libelle: 'Miser',
        construire: (v) => ({ mise: parseInt(v, 10) }),
        apres: (r) => `✅ Mise de ${r.prive.mise} enregistrée. Il te restera ${r.prive.reste} points si tu passes.`,
      });
    },
    resultat(zone, d, ctx) {
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      const max = Math.max(1, ...d.lignes.map((l) => l.mise));
      zone.innerHTML = '';
      LW.ui.classement(zone, [...d.lignes].reverse().map((l) => ({ joueurId: l.joueurId, valeur: l.mise + max * 0.02, texte: `${l.mise}`, ok: survivants.has(l.joueurId) })), ctx, { max: max * 1.02 });
      const pts = ctx.vue?.points?.[String(ctx.moi.id)];
      if (pts !== undefined) zone.insertAdjacentHTML('afterbegin', `<div class="badge or">Ton budget restant : 💎 ${pts}</div>`);
    },
  };
})();
