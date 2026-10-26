/* Affichage : Quiz */
(function () {
  const LETTRES = ['A', 'B', 'C', 'D'];
  LW.miniJeux.quiz = {
    monter(zone, ctx) {
      const p = ctx.public;
      zone.insertAdjacentHTML('beforeend', `<div class="ligne" style="justify-content:center"><span class="badge">${LW.echapper(p.categorie)}</span><span class="muet petit">Question ${p.numero}</span></div>`);
      LW.ui.choix(zone, ctx, p.choix.map((c, i) => ({ valeur: i, libelle: `${LETTRES[i]}. ${c}` })), (v) => ({ reponse: Number(v) }), { colonnes: p.choix.length > 2 ? 2 : p.choix.length });
      zone.querySelectorAll('.choix-grille .btn').forEach((b) => { b.style.minHeight = '64px'; b.style.fontSize = '1.05rem'; });
    },
    resultat(zone, d) {
      const total = Math.max(1, d.compte.reduce((a, b) => a + b, 0));
      zone.innerHTML = `<div class="consigne" style="margin:0">${LW.echapper(d.question)}</div>
        <div class="barres" style="max-width:520px">${d.choix.map((c, i) => `<div class="barre-res ${i === d.bonne ? 'gagne' : 'perd'}" style="grid-template-columns:1.4fr 1fr 40px">
          <span>${i === d.bonne ? '✅' : '❌'} ${LW.echapper(c)}</span><div class="jauge"><div style="width:${(d.compte[i] / total) * 100}%"></div></div><b>${d.compte[i]}</b></div>`).join('')}</div>`;
    },
  };
})();
