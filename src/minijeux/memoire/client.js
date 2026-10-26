/* Affichage : Mémoire (type Simon) */
(function () {
  const COUL = { rouge: '#ef4b4b', vert: '#3fbf6f', bleu: '#4ea1ff', jaune: '#f5c542' };
  const style = document.createElement('style');
  style.textContent = `
    .simon { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: min(320px, 100%); aspect-ratio: 1; }
    .simon button { border: none; border-radius: 18px; opacity: .35; cursor: pointer; transition: opacity .08s, transform .08s; touch-action: manipulation; }
    .simon button.allume { opacity: 1; transform: scale(1.04); box-shadow: 0 0 30px currentColor; }
    .simon button:disabled { cursor: default; }
    .saisie-simon { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; min-height: 22px; }
    .saisie-simon i { width: 20px; height: 20px; border-radius: 50%; display: inline-block; }`;
  document.head.appendChild(style);

  let saisie = [];
  let longueur = 0;
  let minuteurs = [];

  LW.miniJeux.memoire = {
    monter(zone, ctx) {
      saisie = [];
      longueur = ctx.public.longueur;
      const deja = !!ctx.monAction;
      zone.innerHTML = `<div class="badge or" style="font-size:1rem;padding:6px 14px">Séquence de ${longueur} couleurs</div>
        <div class="simon">${Object.entries(COUL).map(([c, hex]) => `<button data-c="${c}" style="background:${hex};color:${hex}" disabled></button>`).join('')}</div>
        <div class="saisie-simon" id="saisie"></div>
        <div id="msg-simon" class="muet">${deja ? '✅ Séquence envoyée.' : 'Regarde bien…'}</div>
        <button class="btn petit cache" id="effacer">↺ Recommencer ma saisie</button>`;
      zone.querySelectorAll('.simon button').forEach((b) => (b.onclick = () => this.appuyer(zone, ctx, b.dataset.c)));
      zone.querySelector('#effacer').onclick = () => { saisie = []; this.majSaisie(zone); };
    },
    allumer(zone, couleur, duree) {
      const b = zone.querySelector(`.simon [data-c="${couleur}"]`);
      if (!b) return;
      b.classList.add('allume');
      minuteurs.push(setTimeout(() => b.classList.remove('allume'), duree));
    },
    surEvenement(zone, ctx, ev) {
      if (ev.type === 'flash' && !ev.rattrapage) this.allumer(zone, ev.donnees.couleur, ev.donnees.duree);
      if (ev.type === 'atoi') {
        if (!ctx.peutJouer || ctx.monAction) { zone.querySelector('#msg-simon').textContent = ctx.monAction ? '✅ Séquence envoyée.' : '👀 Spectateur'; return; }
        zone.querySelectorAll('.simon button').forEach((b) => { b.disabled = false; });
        zone.querySelector('#effacer').classList.remove('cache');
        zone.querySelector('#msg-simon').textContent = `À toi ! Reproduis la séquence (${longueur} couleurs).`;
      }
    },
    majSaisie(zone) {
      zone.querySelector('#saisie').innerHTML = saisie.map((c) => `<i style="background:${COUL[c]}"></i>`).join('');
    },
    async appuyer(zone, ctx, c) {
      if (saisie.length >= longueur) return;
      saisie.push(c);
      this.allumer(zone, c, 180);
      this.majSaisie(zone);
      if (saisie.length === longueur) {
        zone.querySelectorAll('.simon button').forEach((b) => { b.disabled = true; });
        zone.querySelector('#effacer').classList.add('cache');
        const rep = await ctx.agir({ sequence: saisie });
        if (!rep.ok) { saisie = []; this.majSaisie(zone); zone.querySelectorAll('.simon button').forEach((b) => { b.disabled = false; }); return; }
        zone.querySelector('#msg-simon').textContent = rep.prive.juste ? '✅ Parfait !' : '❌ Ce n\'était pas la bonne séquence…';
      }
    },
    demonter() { minuteurs.forEach(clearTimeout); minuteurs = []; },
    resultat(zone, d) {
      zone.innerHTML = `<div class="saisie-simon">${d.sequence.map((c) => `<i style="background:${COUL[c]};width:26px;height:26px"></i>`).join('')}</div>
        <div class="muet">✅ ${d.justes} bonne(s) séquence(s) · ❌ ${d.faux} erreur(s)</div>`;
    },
  };
})();
