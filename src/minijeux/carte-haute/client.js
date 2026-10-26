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
    @keyframes retourne { 0% { transform: rotateY(90deg); } 100% { transform: rotateY(0); } }

    /* révélation de toutes les cartes */
    .table-cartes { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; width: 100%; }
    .tc { width: 64px; display: flex; flex-direction: column; align-items: center; gap: 4px; transition: opacity .4s, transform .4s; }
    .tc .face { width: 56px; height: 78px; border-radius: 8px; perspective: 400px; position: relative; }
    .tc .face > div { position: absolute; inset: 0; border-radius: 8px; backface-visibility: hidden; transition: transform .5s; }
    .tc .dos { background: repeating-linear-gradient(45deg, #b85f00, #b85f00 5px, #f5a524 5px, #f5a524 10px); border: 3px solid #fff; }
    .tc .avant { background: #fff; color: #1b1f27; transform: rotateY(180deg); display: grid; place-items: center; font: 800 1.15rem var(--titre); line-height: 1.1; text-align: center; }
    .tc .avant.rouge { color: #d22; }
    .tc.vue .dos { transform: rotateY(180deg); }
    .tc.vue .avant { transform: rotateY(0); }
    .tc .nom { font-size: .72rem; max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--texte-2); }
    .tc.moi .nom { color: var(--accent-2); font-weight: 700; }
    .table-cartes.jugee .tc.perd { opacity: .35; transform: scale(.92); }
    .table-cartes.jugee .tc.gagne .avant { box-shadow: 0 0 0 3px var(--vert); }
    .table-cartes.jugee .tc.top { transform: scale(1.12); }
    .table-cartes.jugee .tc.top .avant { box-shadow: 0 0 0 3px #ffd34d, 0 0 22px rgba(255, 211, 77, .7); }
    .tc .couronne { height: 18px; font-size: 16px; line-height: 18px; opacity: 0; transition: opacity .3s; }
    .table-cartes.jugee .tc.top .couronne { opacity: 1; animation: monte .4s; }`;
  document.head.appendChild(style);

  const rouge = (c) => c.couleur === '♥' || c.couleur === '♦';
  const carte = (c) => `<div class="carte-jeu carte-retourne ${rouge(c) ? 'rouge' : ''}"><div>${c.valeur}${c.couleur}</div><div class="centre">${c.couleur}</div><div class="bas">${c.valeur}${c.couleur}</div></div>`;
  let minuteurs = [];

  LW.miniJeux['carte-haute'] = {
    formater: () => '🂠 a tiré',
    monter(zone, ctx) {
      const deja = ctx.monAction?.fini;
      zone.innerHTML = `<div id="ma-carte"><div class="carte-dos"></div></div>
        ${ctx.peutJouer && !deja ? '<button class="btn principal geant" id="tirer">🃏 Tirer une carte</button>' : ''}
        <div class="muet petit" id="msg-carte">${deja ? 'Carte tirée. Toutes les cartes seront révélées à la fin du tour.' : ''}</div>`;
      const btn = zone.querySelector('#tirer');
      if (btn) btn.onclick = async () => {
        btn.disabled = true;
        const rep = await ctx.agir({});
        if (!rep.ok) { btn.disabled = false; return; }
        btn.remove();
        zone.querySelector('#ma-carte').innerHTML = carte(rep.prive);
        zone.querySelector('#msg-carte').textContent = 'Ta carte (les autres ne la voient pas). Toutes les cartes seront révélées à la fin du tour.';
      };
    },

    /**
     * Résultats : toutes les cartes face cachée (meilleure en premier), retournées une à une
     * de la plus basse à la plus haute, puis mise en valeur des qualifiés et de la meilleure carte.
     * ctx.revelation.ecouleMs permet de reprendre au bon endroit après une reconnexion.
     */
    resultat(zone, d, ctx) {
      minuteurs.forEach(clearTimeout); minuteurs = [];
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      const max = d.lignes[0]?.score;
      const moi = String(ctx.moi.id);
      zone.insertAdjacentHTML('beforeend', `<div class="table-cartes">${d.lignes.map((l) => `
        <div class="tc ${survivants.has(l.joueurId) ? 'gagne' : 'perd'} ${l.score === max ? 'top' : ''} ${l.joueurId === moi ? 'moi' : ''}">
          <div class="couronne">👑</div>
          <div class="face"><div class="dos"></div><div class="avant ${rouge(l) ? 'rouge' : ''}">${l.valeur}<br>${l.couleur}</div></div>
          <div class="nom" title="${LW.echapper(ctx.pseudo(l.joueurId))}">${LW.echapper(ctx.pseudo(l.joueurId))}</div>
        </div>`).join('')}</div>`);
      const table = zone.querySelector('.table-cartes');
      const cartes = [...table.children];
      const ecoule = ctx.revelation?.ecouleMs ?? 0;
      const pas = d.pasMs ?? 100;
      const jugeA = cartes.length * pas + 600;
      // de la dernière (plus basse) à la première (plus haute)
      cartes.slice().reverse().forEach((el, i) => {
        const quand = i * pas - ecoule;
        if (quand <= 0) el.classList.add('vue'); else minuteurs.push(setTimeout(() => el.classList.add('vue'), quand));
      });
      if (jugeA - ecoule <= 0) table.classList.add('jugee');
      else minuteurs.push(setTimeout(() => table.classList.add('jugee'), jugeA - ecoule));
    },
  };
})();
