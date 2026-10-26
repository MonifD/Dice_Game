/* Affichage : Calcul mental */
(function () {
  LW.miniJeux['calcul-mental'] = {
    monter(zone, ctx) {
      zone.innerHTML = `<div class="grand-texte" style="letter-spacing:.04em">${LW.echapper(ctx.public.expression)} = ?</div>`;
      LW.ui.saisieNombre(zone, ctx, {
        placeholder: 'Résultat',
        construire: (v) => ({ reponse: v }),
        apres: (r) => (r.prive.juste ? '✅ Juste ! Reste à voir si tu as été assez rapide…' : '❌ Mauvaise réponse…'),
      });
    },
    resultat(zone, d, ctx) {
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      zone.innerHTML = `<div class="muet">${d.erreurs ? `❌ ${d.erreurs} mauvaise(s) réponse(s)` : 'Aucune erreur !'}</div>`;
      const max = Math.max(1, ...d.lignes.map((l) => l.tempsMs));
      LW.ui.classement(zone, d.lignes.map((l) => ({ joueurId: l.joueurId, valeur: max - l.tempsMs + 100, texte: `${(l.tempsMs / 1000).toFixed(2)} s`, ok: survivants.has(l.joueurId) })), ctx, { max: max + 100 });
    },
  };
})();
