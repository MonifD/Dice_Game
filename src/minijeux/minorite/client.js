/* Affichage : La minorité gagne */
(function () {
  LW.miniJeux.minorite = {
    monter(zone, ctx) {
      const { a, b } = ctx.public;
      zone.insertAdjacentHTML('beforeend', '<p class="muet" style="margin:0;text-align:center">Les choix restent secrets jusqu\'à la fin du tour. Seuls ceux du camp le <b>moins nombreux</b> survivent.</p>');
      LW.ui.choix(zone, ctx, [{ valeur: 'A', libelle: a, icone: '🅰️' }, { valeur: 'B', libelle: b, icone: '🅱️' }], (v) => ({ choix: v }), { colonnes: 2 });
    },
    resultat(zone, d) {
      const total = Math.max(1, d.nA + d.nB);
      const gagnant = d.nA === d.nB ? null : d.nA < d.nB ? 'A' : 'B';
      const ligne = (k, lib, n) => `<div class="barre-res ${gagnant === null || gagnant === k ? 'gagne' : 'perd'}"><span>${LW.echapper(lib)}</span><div class="jauge"><div style="width:${(n / total) * 100}%"></div></div><b>${n}</b></div>`;
      zone.innerHTML = `<div class="barres" style="max-width:460px">${ligne('A', d.a, d.nA)}${ligne('B', d.b, d.nB)}</div>`;
    },
  };
})();
