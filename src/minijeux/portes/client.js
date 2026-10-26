/* Affichage : Les portes */
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .portes { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 12px; width: 100%; max-width: 640px; }
    .porte { min-height: 150px; border-radius: 12px 12px 4px 4px; border: 3px solid #5a3b1a; background: linear-gradient(180deg, #8a5a2b, #6b4420);
      color: #fff; font: 800 1.6rem var(--titre); cursor: pointer; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
    .porte::after { content: ''; position: absolute; right: 14px; top: 50%; width: 10px; height: 10px; border-radius: 50%; background: #f5c542; }
    .porte:disabled { cursor: default; opacity: .85; }
    .porte.choisie { outline: 4px solid var(--accent); outline-offset: 3px; }
    .porte.piege { background: linear-gradient(180deg, #a12a2a, #6b1515); border-color: #ef4b4b; }
    .porte.sure { background: linear-gradient(180deg, #2e7d4f, #1b5032); border-color: #3fbf6f; }
    .porte .nb { font: 600 .85rem var(--corps); background: rgba(0,0,0,.35); padding: 2px 8px; border-radius: 99px; }`;
  document.head.appendChild(style);

  let compte = {};
  LW.miniJeux.portes = {
    formater: (p) => `🚪 ${p.porte}`,
    monter(zone, ctx) {
      const n = ctx.public.nbPortes;
      compte = {};
      for (const a of ctx.tour.actions) if (a.public?.porte) compte[a.public.porte] = (compte[a.public.porte] || 0) + 1;
      const deja = !!ctx.monAction;
      zone.innerHTML = `<div class="portes">${Array.from({ length: n }, (_, i) => `<button class="porte" data-p="${i + 1}" ${!ctx.peutJouer || deja ? 'disabled' : ''}>
        ${i + 1}<span class="nb" data-n="${i + 1}">${ctx.public.voirChoix ? `${compte[i + 1] || 0} 👤` : ''}</span></button>`).join('')}</div>
        <div class="muet petit" id="msg-porte">${deja ? '✅ Porte choisie. Verdict à la fin du tour…' : ''}</div>`;
      if (deja && ctx.monAction.public?.porte) zone.querySelector(`[data-p="${ctx.monAction.public.porte}"]`)?.classList.add('choisie');
      zone.querySelectorAll('.porte').forEach((b) => (b.onclick = async () => {
        zone.querySelectorAll('.porte').forEach((x) => { x.disabled = true; });
        b.classList.add('choisie');
        const rep = await ctx.agir({ porte: Number(b.dataset.p) });
        if (!rep.ok) { zone.querySelectorAll('.porte').forEach((x) => { x.disabled = false; }); b.classList.remove('choisie'); return; }
        zone.querySelector('#msg-porte').textContent = '✅ Porte choisie. Verdict à la fin du tour…';
      }));
    },
    surAAgi(zone, ctx, a) {
      if (!a.public?.porte || !ctx.public.voirChoix) return;
      compte[a.public.porte] = (compte[a.public.porte] || 0) + 1;
      const el = zone.querySelector(`[data-n="${a.public.porte}"]`);
      if (el) el.textContent = `${compte[a.public.porte]} 👤`;
    },
    resultat(zone, d) {
      zone.innerHTML = `<div class="portes">${Object.entries(d.compte).map(([p, n]) => `<div class="porte ${d.piegees.includes(Number(p)) ? 'piege' : 'sure'}">
        ${d.piegees.includes(Number(p)) ? '💥' : '✅'} ${p}<span class="nb">${n} 👤</span></div>`).join('')}</div>`;
    },
  };
})();
