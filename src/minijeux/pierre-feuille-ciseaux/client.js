/* Affichage : Pierre-feuille-ciseaux contre le serveur */
(function () {
  const IC = { pierre: '✊', feuille: '✋', ciseaux: '✌️' };
  const ISSUE = { gagne: ['Gagné !', 'qualifie'], egalite: ['Égalité : tu continues', 'qualifie'], perdu: ['Perdu…', 'elimine'] };

  function duel(zone, r) {
    const [txt, cls] = ISSUE[r.issue];
    zone.querySelector('.duel')?.remove();
    zone.insertAdjacentHTML('beforeend', `<div class="duel pile" style="align-items:center">
      <div class="ligne" style="gap:30px;font-size:70px;justify-content:center"><span title="Toi">${IC[r.coup]}</span><span class="muet" style="font-size:1.4rem">VS</span><span title="Serveur">${IC[r.serveur]}</span></div>
      <div class="ligne muet petit" style="gap:60px;justify-content:center"><span>Toi</span><span>Serveur</span></div>
      <div class="bandeau ${cls}" style="margin:0">${txt}</div></div>`);
  }

  LW.miniJeux['pierre-feuille-ciseaux'] = {
    formater: (p) => (p.issue ? `${IC[p.coup]} vs ${IC[p.serveur]} ${p.issue === 'perdu' ? '❌' : p.issue === 'gagne' ? '✅' : '🟰'}` : '✓'),
    monter(zone, ctx) {
      if (ctx.monAction?.public?.issue) return duel(zone, ctx.monAction.public);
      // en mode individuel, le serveur répond tout de suite avec son coup
      LW.ui.choix(zone, ctx, Object.entries(IC).map(([v, i]) => ({ valeur: v, libelle: v[0].toUpperCase() + v.slice(1), icone: i })), (v) => ({ coup: v }), {
        colonnes: 3,
        apres: (rep) => { if (rep.prive?.issue) { zone.innerHTML = ''; duel(zone, rep.prive); } },
      });
    },
    resultat(zone, d) {
      const total = Math.max(1, d.gagne + d.egalite + d.perdu);
      zone.innerHTML = `${d.serveur ? `<div style="font-size:70px">${IC[d.serveur]}</div>` : ''}
        <div class="barres" style="max-width:420px">
          <div class="barre-res gagne"><span>Gagné</span><div class="jauge"><div style="width:${(d.gagne / total) * 100}%"></div></div><b>${d.gagne}</b></div>
          <div class="barre-res gagne"><span>Égalité</span><div class="jauge"><div style="width:${(d.egalite / total) * 100}%"></div></div><b>${d.egalite}</b></div>
          <div class="barre-res perd"><span>Perdu</span><div class="jauge"><div style="width:${(d.perdu / total) * 100}%"></div></div><b>${d.perdu}</b></div>
        </div>`;
    },
  };
})();
