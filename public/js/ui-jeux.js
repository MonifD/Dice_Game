/**
 * Composants d'affichage réutilisables par les mini-jeux (src/minijeux/<id>/client.js).
 */
(function () {
  const LW = window.LW;
  const e = (s) => LW.echapper(s);

  LW.ui = {
    /**
     * Grille de gros boutons de choix (pile/face, A/B, portes, réponses du quiz…).
     * @param options [{ valeur, libelle, icone }]
     * @param construire (valeur) => données envoyées au serveur
     */
    choix(zone, ctx, options, construire, { colonnes, apres } = {}) {
      const dejaJoue = !!ctx.monAction;
      zone.insertAdjacentHTML('beforeend', `<div class="choix-grille" ${colonnes ? `style="grid-template-columns:repeat(${colonnes},1fr)"` : ''}>
        ${options.map((o) => `<button class="btn" data-v="${e(o.valeur)}" ${!ctx.peutJouer || dejaJoue ? 'disabled' : ''}>
          ${o.icone ? `<span class="gros">${o.icone}</span>` : ''}<span>${e(o.libelle)}</span></button>`).join('')}</div>
        <div class="muet petit msg-choix">${dejaJoue ? '✅ Choix enregistré. Résultat à la fin du tour.' : ctx.peutJouer ? '' : 'Tu regardes en spectateur.'}</div>`);
      const grille = zone.querySelector('.choix-grille');
      const msg = zone.querySelector('.msg-choix');
      grille.querySelectorAll('button').forEach((b) => {
        b.onclick = async () => {
          grille.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          b.classList.add('choisi');
          const rep = await ctx.agir(construire(b.dataset.v));
          if (!rep.ok) { grille.querySelectorAll('button').forEach((x) => { x.disabled = false; }); b.classList.remove('choisi'); return; }
          msg.textContent = '✅ Choix enregistré. Résultat à la fin du tour.';
          if (apres) apres(rep);
        };
      });
      return grille;
    },

    /** Champ numérique + bouton valider. */
    saisieNombre(zone, ctx, { min, max, placeholder, libelle = 'Valider', construire, apres }) {
      const deja = !!ctx.monAction;
      zone.insertAdjacentHTML('beforeend', `<form class="ligne saisie-nombre" style="justify-content:center;width:100%;max-width:420px">
        <input type="number" inputmode="numeric" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} placeholder="${e(placeholder || '')}"
          style="flex:1;font-size:1.6rem;text-align:center;font-family:var(--titre)" ${!ctx.peutJouer || deja ? 'disabled' : ''} required>
        <button class="btn principal" style="min-height:52px" ${!ctx.peutJouer || deja ? 'disabled' : ''}>${e(libelle)}</button></form>
        <div class="muet petit msg-nombre">${deja ? '✅ Réponse enregistrée.' : ''}</div>`);
      const form = zone.querySelector('.saisie-nombre');
      const input = form.querySelector('input');
      if (ctx.peutJouer && !deja) setTimeout(() => input.focus(), 50);
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const v = input.value.trim();
        if (v === '') return;
        form.querySelectorAll('input,button').forEach((x) => { x.disabled = true; });
        const rep = await ctx.agir(construire(v));
        if (!rep.ok) { form.querySelectorAll('input,button').forEach((x) => { x.disabled = false; }); return; }
        zone.querySelector('.msg-nombre').textContent = apres ? apres(rep) : '✅ Réponse enregistrée.';
      };
      return form;
    },

    /**
     * Classement horizontal (barres) pour l'écran de résultats.
     * @param lignes [{ joueurId, valeur, texte, ok }]  (déjà triées)
     */
    classement(zone, lignes, ctx, { max, limite = 12 } = {}) {
      const top = lignes.slice(0, limite);
      const m = max ?? Math.max(1, ...lignes.map((l) => Math.abs(l.valeur)));
      const moi = String(ctx.moi.id);
      const maLigne = lignes.findIndex((l) => l.joueurId === moi);
      zone.insertAdjacentHTML('beforeend', `<div class="barres">${top.map((l) => `<div class="barre-res ${l.ok ? 'gagne' : 'perd'}" ${l.joueurId === moi ? 'style="font-weight:700"' : ''}>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(ctx.pseudo(l.joueurId))}</span>
          <div class="jauge"><div style="width:${Math.max(2, (Math.abs(l.valeur) / m) * 100)}%"></div></div><b>${e(l.texte ?? l.valeur)}</b></div>`).join('')}
        ${lignes.length > limite ? `<div class="muet petit" style="text-align:center">… et ${lignes.length - limite} autres${maLigne >= limite ? ` · toi : ${maLigne + 1}e (${e(lignes[maLigne].texte ?? lignes[maLigne].valeur)})` : ''}</div>` : ''}</div>`);
    },

    /** Grande annonce animée (ex. « 💥 Porte 2 ! »). */
    annonce(zone, html) {
      zone.insertAdjacentHTML('beforeend', `<div class="grand-texte" style="animation:monte .35s">${html}</div>`);
    },
  };
})();
