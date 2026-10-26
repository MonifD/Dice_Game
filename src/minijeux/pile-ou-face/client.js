/* Affichage : Pile ou face */
(function () {
  LW.miniJeux['pile-ou-face'] = {
    monter(zone, ctx) {
      LW.ui.choix(zone, ctx, [{ valeur: 'pile', libelle: 'Pile', icone: '🪙' }, { valeur: 'face', libelle: 'Face', icone: '👑' }], (v) => ({ choix: v }), { colonnes: 2 });
    },
    resultat(zone, d) {
      const total = Math.max(1, d.pile + d.face);
      zone.innerHTML = `<div style="font-size:80px;animation:atterrit .5s">${d.resultat === 'pile' ? '🪙' : '👑'}</div>
        <div class="grand-texte" style="font-size:2.2rem">${d.resultat.toUpperCase()}</div>
        <div class="barres" style="max-width:420px">
          <div class="barre-res ${d.resultat === 'pile' ? 'gagne' : 'perd'}"><span>Pile</span><div class="jauge"><div style="width:${(d.pile / total) * 100}%"></div></div><b>${d.pile}</b></div>
          <div class="barre-res ${d.resultat === 'face' ? 'gagne' : 'perd'}"><span>Face</span><div class="jauge"><div style="width:${(d.face / total) * 100}%"></div></div><b>${d.face}</b></div>
        </div>`;
    },
  };
})();
