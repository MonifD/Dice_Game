/* Affichage du tour de départage (mort subite), commun à tous les mini-jeux. */
(function () {
  let anim = null;
  LW.miniJeux._departage = {
    formater: (p) => `⚡ ${p.valeur}`,
    monter(zone, ctx) {
      const deja = ctx.monAction?.public?.valeur;
      zone.innerHTML = `<div class="grand-texte" id="dep-val" style="color:var(--accent-2)">${deja ?? '???'}</div>
        ${ctx.peutJouer && !deja ? '<button class="btn principal geant" id="dep-btn">⚡ Tenter ma chance</button>' : ''}
        <div class="muet">Le plus grand nombre l'emporte. Égalité au sommet = on recommence.</div>`;
      const btn = zone.querySelector('#dep-btn');
      if (btn) btn.onclick = async () => {
        btn.disabled = true;
        const el = zone.querySelector('#dep-val');
        anim = setInterval(() => { el.textContent = 1 + Math.floor(Math.random() * 1000); }, 50);
        const [rep] = await Promise.all([ctx.agir({}), LW.attendre(800)]);
        clearInterval(anim);
        if (!rep.ok) { btn.disabled = false; return; }
        el.textContent = rep.prive.valeur;
        btn.remove();
      };
    },
    demonter() { clearInterval(anim); },
    resultat(zone, d, ctx) {
      const lignes = [...d.lignes].sort((a, b) => b.valeur - a.valeur).slice(0, 10);
      zone.innerHTML = `<div class="barres">${lignes.map((l) => `<div class="barre-res ${l.valeur === d.max ? 'gagne' : 'perd'}">
        <span>${LW.echapper(ctx.pseudo(l.joueurId))}</span><div class="jauge"><div style="width:${l.valeur / 10}%"></div></div><b>${l.valeur}</b></div>`).join('')}</div>`;
    },
  };
})();
