/* Affichage : Feu rouge, feu vert — on clique pour avancer, les clics partent par paquets */
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .feu { width: 90px; height: 90px; border-radius: 50%; background: #3a1010; box-shadow: inset 0 0 0 6px rgba(0,0,0,.4); transition: background .1s, box-shadow .1s; }
    .feu.rouge { background: #ef4b4b; box-shadow: 0 0 40px #ef4b4b; }
    .feu.vert { background: #3fbf6f; box-shadow: 0 0 40px #3fbf6f; }
    .piste { width: 100%; max-width: 560px; height: 26px; background: var(--fond-2); border-radius: 99px; position: relative; overflow: hidden; }
    .piste .moi { position: absolute; top: 0; bottom: 0; left: 0; background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: 99px; transition: width .15s; }
    .btn-avancer { width: 100%; max-width: 420px; min-height: 110px; font-size: 1.6rem; touch-action: manipulation; }`;
  document.head.appendChild(style);

  let paquet = 0;
  let envoi = null;
  let total = 0;
  let pris = false;

  LW.miniJeux['feu-rouge'] = {
    formater: (p) => (p.attrape ? `pris au rouge ❌ (${p.pas})` : `${p.pas} pas`),
    monter(zone, ctx) {
      paquet = 0; total = 0; pris = !!ctx.monAction?.public?.attrape;
      zone.innerHTML = `<div class="feu rouge" id="feu"></div>
        <div class="piste"><div class="moi" id="progression" style="width:0"></div></div>
        <div class="muet" id="pas">0 pas</div>
        ${ctx.peutJouer && !pris ? '<button class="btn principal btn-avancer" id="avancer">👣 AVANCER</button>' : ''}
        <div id="msg-feu"></div>`;
      const btn = zone.querySelector('#avancer');
      if (!btn) { if (pris) zone.querySelector('#msg-feu').innerHTML = '<div class="bandeau elimine">🚨 Pris au rouge !</div>'; return; }
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (pris) return;
        paquet++; total++;
        zone.querySelector('#pas').textContent = `${total} pas`;
        zone.querySelector('#progression').style.width = `${Math.min(100, total / 1.5)}%`;
      });
      // envoi des clics par paquets toutes les 200 ms (le serveur vérifie le feu à la réception)
      envoi = setInterval(async () => {
        if (!paquet || pris) return;
        const n = paquet; paquet = 0;
        const rep = await ctx.agir({ pas: n });
        if (rep.ok && rep.prive?.attrape) {
          pris = true;
          btn.remove();
          zone.querySelector('#msg-feu').innerHTML = '<div class="bandeau elimine">🚨 Pris au rouge !</div>';
        } else if (rep.ok) total = rep.prive.pas;
      }, 200);
    },
    surEvenement(zone, ctx, ev) {
      if (ev.type !== 'feu') return;
      const feu = zone.querySelector('#feu');
      if (feu) feu.className = `feu ${ev.donnees.couleur}`;
    },
    demonter() { clearInterval(envoi); envoi = null; },
    resultat(zone, d, ctx) {
      const survivants = new Set(ctx.etat.dernierResultat.survivants);
      zone.innerHTML = d.attrapes ? `<div class="muet">🚨 ${d.attrapes} joueur(s) pris au rouge.</div>` : '';
      LW.ui.classement(zone, d.lignes.map((l) => ({ joueurId: l.joueurId, valeur: l.attrape ? 0 : l.pas, texte: l.attrape ? '🚨' : `${l.pas}`, ok: survivants.has(l.joueurId) })), ctx);
    },
  };
})();
