/* Affichage du mini-jeu « Lancer de dé » (le tirage est fait par le serveur). */
(function () {
  const POINTS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const style = document.createElement('style');
  style.textContent = `
    .des-joueurs { width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .ligne-de { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 10px; background: var(--panneau-2); font-size: .9rem; opacity: .7; }
    .ligne-de.gagne { opacity: 1; border: 1px solid rgba(63, 191, 111, .45); background: var(--vert-fond); }
    .ligne-de .face-mini { font-size: 1.6rem; line-height: 1; }
    .ligne-de .moi { color: var(--accent-2); font-weight: 700; }
    .de { width: 120px; height: 120px; border-radius: 22px; background: linear-gradient(145deg, #fff, #dfe3ea);
      box-shadow: 0 12px 30px rgba(0,0,0,.45), inset 0 -6px 0 rgba(0,0,0,.08); display: grid;
      grid-template: repeat(3, 1fr) / repeat(3, 1fr); padding: 16px; gap: 4px; }
    .de i { width: 22px; height: 22px; border-radius: 50%; background: #1b1f27; place-self: center; visibility: hidden; }
    .de i.on { visibility: visible; }
    .de.cible-ok { box-shadow: 0 0 0 4px var(--vert), 0 12px 30px rgba(0,0,0,.45); }
    .de.roule { animation: roule .12s linear infinite; }
    @keyframes roule { 0% { transform: rotate(0) scale(1); } 50% { transform: rotate(14deg) scale(.94); } 100% { transform: rotate(-10deg) scale(1); } }
    .de.atterrit { animation: atterrit .35s ease-out; }
    @keyframes atterrit { 0% { transform: scale(1.25) rotate(-12deg); } 100% { transform: scale(1) rotate(0); } }
    .faces { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; width: 100%; max-width: 480px; align-items: end; height: 140px; }
    .face-col { display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
    .face-col .colonne { width: 100%; background: var(--panneau-2); border-radius: 6px 6px 0 0; min-height: 3px; }
    .face-col.gagne .colonne { background: var(--vert); }
    .face-col.vise .colonne { box-shadow: 0 0 0 2px var(--accent) inset; }`;
  document.head.appendChild(style);

  const de = (v) => `<div class="de" id="de">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<i class="${(POINTS[v] || []).includes(i) ? 'on' : ''}"></i>`).join('')}</div>`;
  const afficherFace = (el, v) => el.querySelectorAll('i').forEach((p, i) => p.classList.toggle('on', (POINTS[v] || []).includes(i + 1)));

  let animation = null;

  LW.miniJeux.des = {
    formater: (p) => `🎲 ${p.valeur}`,

    monter(zone, ctx) {
      const { phase, cible } = ctx.public || {};
      const deja = ctx.monAction?.public?.valeur;
      zone.innerHTML = `
        ${phase === 'qualification' ? `<div class="badge or" style="font-size:1rem;padding:6px 14px">Nombre à faire : ${cible}</div>` : '<div class="badge or" style="font-size:1rem;padding:6px 14px">Le plus haut résultat passe</div>'}
        ${de(deja || 6)}
        <div id="msg-de" class="consigne" style="margin:0;min-height:1.6em"></div>
        ${ctx.peutJouer && !deja ? '<button class="btn principal geant" id="btn-lancer">🎲 Lancer le dé</button>' : ''}`;
      const elDe = zone.querySelector('#de');
      const msg = zone.querySelector('#msg-de');
      if (deja) montrerResultat(deja);
      else if (!ctx.peutJouer) msg.innerHTML = '<span class="muet">Regarde les lancers en direct ci-dessous.</span>';

      function montrerResultat(v) {
        afficherFace(elDe, v);
        elDe.classList.remove('roule');
        elDe.classList.add('atterrit');
        if (phase === 'qualification') {
          elDe.classList.toggle('cible-ok', v === cible);
          msg.innerHTML = v === cible ? `Tu as fait <b>${v}</b> : qualifié ✅` : `Tu as fait <b>${v}</b>… raté ❌`;
        } else msg.innerHTML = `Tu as fait <b>${v}</b>. Verdict à la fin du tour !`;
      }

      const btn = zone.querySelector('#btn-lancer');
      if (btn) btn.onclick = async () => {
        btn.disabled = true;
        elDe.classList.add('roule');
        animation = setInterval(() => afficherFace(elDe, 1 + Math.floor(Math.random() * 6)), 90);
        const [rep] = await Promise.all([ctx.agir({}), LW.attendre(900)]);
        clearInterval(animation);
        if (!rep.ok) { elDe.classList.remove('roule'); btn.disabled = false; return; }
        btn.remove();
        montrerResultat(rep.prive.valeur);
      };
    },

    demonter() { clearInterval(animation); },

    resultat(zone, d, ctx) {
      const compte = [0, 0, 0, 0, 0, 0];
      d.lignes.forEach((l) => compte[l.valeur - 1]++);
      const max = Math.max(1, ...compte);
      const gagnante = d.phase === 'qualification' ? d.cible : d.max;
      zone.innerHTML = `<div class="faces">${compte.map((n, i) => `<div class="face-col ${i + 1 === gagnante ? 'gagne' : ''}">
          <b>${n}</b><div class="colonne" style="height:${(n / max) * 90}px"></div><span style="font-size:1.4rem">${'⚀⚁⚂⚃⚄⚅'[i]}</span></div>`).join('')}</div>
        <div class="muet petit">${d.phase === 'qualification' ? `Il fallait faire ${d.cible}.` : `Plus haut résultat : ${d.max}.`}</div>
        <div class="des-joueurs">${[6, 5, 4, 3, 2, 1].filter((v) => compte[v - 1]).map((v) => `<div class="ligne-de ${v === gagnante ? 'gagne' : ''}">
          <span class="face-mini">${'⚀⚁⚂⚃⚄⚅'[v - 1]}</span>
          <span>${d.lignes.filter((l) => l.valeur === v).map((l) => `<span class="${l.joueurId === String(ctx.moi.id) ? 'moi' : ''}">${LW.echapper(ctx.pseudo(l.joueurId))}</span>`).join(', ')}</span></div>`).join('')}</div>`;
    },
  };
})();
