/* Affichage : La minorité gagne */
(function () {
  LW.miniJeux.minorite = {
    monter(zone, ctx) {
      const { a, b } = ctx.public;
      zone.insertAdjacentHTML('beforeend', '<p class="muet" style="margin:0;text-align:center">Les choix restent secrets jusqu\'à la fin du tour. Seuls ceux du camp le <b>moins nombreux</b> survivent.</p>');
      LW.ui.choix(zone, ctx, [{ valeur: 'A', libelle: a, icone: '🅰️' }, { valeur: 'B', libelle: b, icone: '🅱️' }], (v) => ({ choix: v }), { colonnes: 2 });
    },
    /** Panneau de l'organisateur : options A / B du prochain tour (même logique que optionsDuTour côté serveur). */
    orga(zone, ctx) {
      const { params, reglagesOrga: r, prochainTour: t } = ctx.etat;
      const liste = String(params.optionsParTour || '').split(/\r?\n/)
        .map((l) => l.trim().split(/\s*[/|;]\s*/)).filter((p) => p.length === 2 && p[0] && p[1]);
      const prevu = r?.pourTour === t ? r : liste.length ? { a: liste[(t - 1) % liste.length][0], b: liste[(t - 1) % liste.length][1] } : { a: params.optionA || 'A', b: params.optionB || 'B' };
      const e = LW.echapper;
      zone.innerHTML = `<form class="reglage-minorite">
        <div class="titre-reglage">⚖️ Options du tour ${t}${r?.pourTour === t ? ' <span class="badge vert">modifiées</span>' : liste.length ? ' <span class="muet petit">(liste préparée)</span>' : ''}</div>
        <div class="ligne" style="gap:8px">
          <input name="a" maxlength="30" value="${e(prevu.a)}" placeholder="Option A" aria-label="Option A" style="flex:1;min-width:110px">
          <input name="b" maxlength="30" value="${e(prevu.b)}" placeholder="Option B" aria-label="Option B" style="flex:1;min-width:110px">
          <button class="btn petit">Enregistrer pour le tour ${t}</button>
        </div></form>`;
      const form = zone.querySelector('form');
      form.querySelectorAll('input').forEach((i) => i.addEventListener('focus', () => ctx.pause?.(), { once: true }));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const bouton = form.querySelector('button');
        bouton.disabled = true;
        const rep = await ctx.envoyer({ a: form.a.value, b: form.b.value });
        if (!rep.ok) bouton.disabled = false;
      };
    },
    resultat(zone, d) {
      const total = Math.max(1, d.nA + d.nB);
      const gagnant = d.nA === d.nB ? null : d.nA < d.nB ? 'A' : 'B';
      const ligne = (k, lib, n) => `<div class="barre-res ${gagnant === null || gagnant === k ? 'gagne' : 'perd'}"><span>${LW.echapper(lib)}</span><div class="jauge"><div style="width:${(n / total) * 100}%"></div></div><b>${n}</b></div>`;
      zone.innerHTML = `<div class="barres" style="max-width:460px">${ligne('A', d.a, d.nA)}${ligne('B', d.b, d.nB)}</div>`;
    },
  };
})();
