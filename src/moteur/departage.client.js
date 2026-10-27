/* Affichage du tour de départage (mort subite), commun à tous les mini-jeux. */
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .duel { display: flex; flex-wrap: wrap; justify-content: center; align-items: stretch; gap: 14px; width: 100%; }
    .duel .vs { align-self: center; font: 800 1.6rem var(--titre); color: var(--texte-3); }
    .duelliste { flex: 1 1 160px; max-width: 240px; padding: 16px 12px 14px; border-radius: 16px; background: var(--panneau-2); border: 2px solid var(--bord);
      display: flex; flex-direction: column; align-items: center; gap: 6px; transition: transform .45s, opacity .45s, border-color .45s, box-shadow .45s; }
    .duelliste .couronne { font-size: 28px; height: 32px; opacity: 0; transition: opacity .3s; }
    .duelliste .num { font: 800 3.2rem var(--titre); font-variant-numeric: tabular-nums; color: var(--accent-2); line-height: 1; min-width: 3ch; text-align: center; }
    .duelliste .num.roule { color: var(--texte-2); filter: blur(.6px); }
    .duelliste .qui { font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .duelliste.moi .qui { color: var(--accent-2); }
    .duel.petit .duelliste { flex-basis: 110px; padding: 10px 8px; } .duel.petit .num { font-size: 2rem; }
    .duel.deux { flex-wrap: nowrap; gap: 8px; } .duel.deux .duelliste { flex: 1 1 0; min-width: 0; }
    .duel.deux .num { font-size: clamp(2.2rem, 11vw, 3.2rem); } .duel.deux .vs { font-size: 1.1rem; }
    .duel.fini .duelliste.top { border-color: #ffd34d; box-shadow: 0 0 26px rgba(255, 211, 77, .45); transform: scale(1.08); }
    .duel.fini .duelliste.top .couronne { opacity: 1; animation: monte .4s; }
    .duel.fini .duelliste.top .num { color: #ffd34d; }
    .duel.fini .duelliste.perd { opacity: .4; transform: scale(.94); }
    .dep-attente { font: 800 3rem var(--titre); color: var(--accent-2); letter-spacing: .1em; }`;
  document.head.appendChild(style);

  let anim = null;
  let roule = null;
  let minuteurs = [];
  const hasard = () => 1 + Math.floor(Math.random() * 1000);

  LW.miniJeux._departage = {
    formater: () => '⚡ a tiré',
    monter(zone, ctx) {
      const deja = ctx.monAction?.fini;
      zone.innerHTML = `<div class="dep-attente" id="dep-val">???</div>
        ${ctx.peutJouer && !deja ? '<button class="btn principal geant" id="dep-btn">⚡ Tenter ma chance</button>' : ''}
        <div class="muet" id="dep-msg">${deja ? '✅ Nombre tiré. Révélation quand tout le monde aura tiré…' : 'Le plus grand nombre l\'emporte. Tous les tirages sont révélés en même temps.'}</div>`;
      const btn = zone.querySelector('#dep-btn');
      if (btn) btn.onclick = async () => {
        btn.disabled = true;
        const el = zone.querySelector('#dep-val');
        anim = setInterval(() => { el.textContent = hasard(); }, 50);
        const [rep] = await Promise.all([ctx.agir({}), LW.attendre(700)]);
        clearInterval(anim);
        el.textContent = '???';
        if (!rep.ok) { btn.disabled = false; return; }
        btn.remove();
        zone.querySelector('#dep-msg').textContent = '✅ Nombre tiré (secret). Révélation quand tout le monde aura tiré…';
      };
    },
    demonter() { clearInterval(anim); },

    /**
     * Révélation commune : tous les compteurs défilent puis s'arrêtent ensemble (synchronisé sur l'heure
     * du serveur grâce à ctx.revelation.ecouleMs), puis le gagnant est mis en valeur.
     */
    resultat(zone, d, ctx) {
      minuteurs.forEach(clearTimeout); minuteurs = []; clearInterval(roule);
      const moi = String(ctx.moi.id);
      // les 12 meilleurs tirages, affichés par ordre alphabétique (même ordre sur tous les écrans,
      // et la position ne trahit pas le gagnant avant l'arrêt des compteurs)
      const lignes = d.lignes.slice(0, 12).sort((a, b) => ctx.pseudo(a.joueurId).localeCompare(ctx.pseudo(b.joueurId), 'fr'));
      const e = LW.echapper;
      zone.innerHTML = `<div class="duel ${lignes.length > 4 ? 'petit' : ''} ${lignes.length === 2 ? 'deux' : ''}">${lignes.map((l, i) => `
        ${i && lignes.length === 2 ? '<div class="vs">VS</div>' : ''}
        <div class="duelliste ${l.valeur === d.max ? 'top' : 'perd'} ${l.joueurId === moi ? 'moi' : ''}">
          <div class="couronne">👑</div><div class="num roule">???</div><div class="qui">${e(ctx.pseudo(l.joueurId))}</div>
        </div>`).join('')}</div>
        ${d.lignes.length > lignes.length ? `<div class="muet petit">… et ${d.lignes.length - lignes.length} autres tirages, plus bas.</div>` : ''}`;
      const duel = zone.querySelector('.duel');
      const nums = [...zone.querySelectorAll('.num')];
      const reste = (d.roulementMs ?? 3000) - (ctx.revelation?.ecouleMs ?? 0);
      const arreter = () => {
        clearInterval(roule);
        nums.forEach((n, i) => { n.textContent = lignes[i].valeur; n.classList.remove('roule'); });
        duel.classList.add('fini');
      };
      roule = setInterval(() => nums.forEach((n) => { n.textContent = hasard(); }), 60);
      if (reste <= 0) arreter(); else minuteurs.push(setTimeout(arreter, reste));
    },
  };
})();
