/* Affichage : Le juste prix — image de points affichée quelques secondes */
(function () {
  let minuteur = null;
  LW.miniJeux['juste-prix'] = {
    monter(zone, ctx) {
      const p = ctx.public;
      const restant = ctx.tour.debutMs + p.affichageMs - ctx.maintenant();
      zone.innerHTML = `<div style="position:relative;width:100%;max-width:520px">
          <img id="jp-image" src="${p.image}" alt="Points à compter" style="width:100%;border-radius:12px;display:${restant > 0 ? 'block' : 'none'};user-select:none;-webkit-user-drag:none">
          <div id="jp-cache" class="vide" style="display:${restant > 0 ? 'none' : 'block'};border:1px dashed var(--bord);border-radius:12px">🙈 Image cachée — à toi d'estimer !</div>
        </div>`;
      LW.ui.saisieNombre(zone, ctx, {
        min: 0, max: p.max * 3, placeholder: 'Ton estimation',
        construire: (v) => ({ estimation: parseInt(v, 10) }),
        apres: (r) => `✅ Estimation : ${r.prive.estimation}`,
      });
      if (restant > 0) minuteur = setTimeout(() => this.cacher(zone), restant);
    },
    cacher(zone) {
      const img = zone.querySelector('#jp-image');
      if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
      const c = zone.querySelector('#jp-cache');
      if (c) c.style.display = 'block';
    },
    surEvenement(zone, ctx, ev) { if (ev.type === 'cacher') this.cacher(zone); },
    demonter() { clearTimeout(minuteur); },
    resultat(zone, d, ctx) {
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      zone.innerHTML = `<div class="grand-texte" style="font-size:3.2rem">${d.bonne}</div>`;
      const max = Math.max(1, ...d.lignes.map((l) => l.ecart));
      LW.ui.classement(zone, d.lignes.map((l) => ({ joueurId: l.joueurId, valeur: max - l.ecart + 1, texte: `${l.estimation} (±${l.ecart})`, ok: survivants.has(l.joueurId) })), ctx, { max: max + 1 });
    },
  };
})();
