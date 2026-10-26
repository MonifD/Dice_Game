/* Affichage : La carte la plus haute */
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .carte-jeu { width: 120px; height: 168px; border-radius: 12px; background: #fff; color: #1b1f27; display: flex; flex-direction: column;
      justify-content: space-between; padding: 10px 12px; font-family: var(--titre); font-weight: 800; box-shadow: 0 12px 30px rgba(0,0,0,.45); }
    .carte-jeu.rouge { color: #d22; }
    .carte-jeu .centre { font-size: 3.2rem; text-align: center; line-height: 1; }
    .carte-jeu .bas { transform: rotate(180deg); }
    .carte-dos { width: 120px; height: 168px; border-radius: 12px; background: repeating-linear-gradient(45deg, #b85f00, #b85f00 8px, #f5a524 8px, #f5a524 16px);
      border: 6px solid #fff; box-shadow: 0 12px 30px rgba(0,0,0,.45); }
    .carte-retourne { animation: retourne .5s ease-out; }
    @keyframes retourne { 0% { transform: rotateY(90deg); } 100% { transform: rotateY(0); } }`;
  document.head.appendChild(style);

  const carte = (c) => {
    const rouge = c.couleur === '♥' || c.couleur === '♦';
    return `<div class="carte-jeu carte-retourne ${rouge ? 'rouge' : ''}"><div>${c.valeur}${c.couleur}</div><div class="centre">${c.couleur}</div><div class="bas">${c.valeur}${c.couleur}</div></div>`;
  };

  LW.miniJeux['carte-haute'] = {
    formater: (p) => `${p.valeur}${p.couleur}`,
    monter(zone, ctx) {
      const deja = ctx.monAction?.public;
      zone.innerHTML = `<div id="ma-carte">${deja ? carte(deja) : '<div class="carte-dos"></div>'}</div>
        ${ctx.peutJouer && !deja ? '<button class="btn principal geant" id="tirer">🃏 Tirer une carte</button>' : ''}`;
      const btn = zone.querySelector('#tirer');
      if (btn) btn.onclick = async () => {
        btn.disabled = true;
        const rep = await ctx.agir({});
        if (!rep.ok) { btn.disabled = false; return; }
        btn.remove();
        zone.querySelector('#ma-carte').innerHTML = carte(rep.prive);
      };
    },
    resultat(zone, d, ctx) {
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      LW.ui.classement(zone, d.lignes.map((l) => ({ joueurId: l.joueurId, valeur: l.score + 1, texte: `${l.valeur}${l.couleur}`, ok: survivants.has(l.joueurId) })), ctx);
    },
  };
})();
