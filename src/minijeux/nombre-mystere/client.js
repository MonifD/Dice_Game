/* Affichage : Nombre mystère */
(function () {
  LW.miniJeux['nombre-mystere'] = {
    monter(zone, ctx) {
      zone.insertAdjacentHTML('beforeend', '<div style="font-size:64px">🔮</div>');
      LW.ui.saisieNombre(zone, ctx, {
        min: 1, max: ctx.public.max, placeholder: `1 à ${ctx.public.max}`,
        construire: (v) => ({ nombre: parseInt(v, 10) }),
        apres: (r) => `✅ Tu as proposé ${r.prive.nombre}. Le nombre mystère sera révélé à la fin du tour.`,
      });
    },
    resultat(zone, d, ctx) {
      zone.innerHTML = `<div class="grand-texte" style="font-size:3.5rem">${d.mystere}</div>`;
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      LW.ui.classement(zone, d.lignes.map((l) => ({ joueurId: l.joueurId, valeur: d.max - l.ecart, texte: `${l.nombre} (±${l.ecart})`, ok: survivants.has(l.joueurId) })), ctx, { max: d.max });
    },
  };
})();
