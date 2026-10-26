/* Affichage : Roue de la fortune — animation pendant que le serveur fait son tirage */
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .roue { width: min(280px, 80vw); aspect-ratio: 1; border-radius: 50%; border: 8px solid #2a313c; position: relative;
      background: conic-gradient(#f5a524 0 45deg, #ef4b4b 45deg 90deg, #4ea1ff 90deg 135deg, #3fbf6f 135deg 180deg, #f5a524 180deg 225deg, #ef4b4b 225deg 270deg, #4ea1ff 270deg 315deg, #3fbf6f 315deg 360deg);
      box-shadow: 0 10px 40px rgba(0,0,0,.5); }
    .roue.tourne { animation: tourne var(--duree, 6s) cubic-bezier(.15,.6,.2,1) forwards; }
    @keyframes tourne { to { transform: rotate(var(--angle, 2160deg)); } }
    .roue::after { content: ''; position: absolute; inset: 38%; border-radius: 50%; background: var(--panneau); border: 4px solid #2a313c; }
    .fleche { width: 0; height: 0; border-left: 16px solid transparent; border-right: 16px solid transparent; border-top: 26px solid #fff; margin-bottom: -18px; z-index: 2; filter: drop-shadow(0 2px 4px rgba(0,0,0,.5)); }`;
  document.head.appendChild(style);

  let defile = null;
  LW.miniJeux.roue = {
    monter(zone, ctx) {
      const restant = Math.max(500, ctx.tour.finMs - ctx.maintenant());
      const enJeu = ctx.etat.joueurs.filter((j) => j.statut === 'enJeu');
      zone.innerHTML = `<div class="fleche"></div><div class="roue" id="roue"></div><div class="grand-texte" id="nom-roue" style="font-size:1.6rem;min-height:2.2rem"></div>`;
      const roue = zone.querySelector('#roue');
      roue.style.setProperty('--duree', `${restant / 1000}s`);
      roue.style.setProperty('--angle', `${1800 + Math.floor(Math.random() * 720)}deg`);
      requestAnimationFrame(() => roue.classList.add('tourne'));
      const nom = zone.querySelector('#nom-roue');
      let i = 0;
      const tic = () => {
        nom.textContent = enJeu[i++ % enJeu.length]?.pseudo || '';
        const reste = ctx.tour.finMs - ctx.maintenant();
        if (reste > 0) defile = setTimeout(tic, Math.min(400, 60 + (1 - reste / restant) * 350));
      };
      tic();
    },
    demonter() { clearTimeout(defile); },
    resultat(zone, d, ctx) {
      zone.innerHTML = `<div class="muet">La roue a désigné :</div><div class="puces" style="justify-content:center">${d.elimines.map((id) => `<span class="puce" style="border-color:var(--rouge)">💀 ${LW.echapper(ctx.pseudo(id))}</span>`).join('')}</div>`;
    },
  };
})();
