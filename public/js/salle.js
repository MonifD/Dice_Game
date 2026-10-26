/**
 * Salle de jeu : salle d'attente, tours, spectateurs, résultats et écran du gagnant.
 *
 * Cette page est commune à TOUS les mini-jeux. L'affichage propre à un jeu est
 * délégué au script /minijeux/<id>/client.js qui s'enregistre dans LW.miniJeux[id] :
 *
 *   LW.miniJeux['des'] = {
 *     monter(zone, ctx)            affiche le tour (appelé au début de chaque tour / à la reconnexion)
 *     surAAgi(zone, ctx, action)   un joueur vient d'agir ({ joueurId, pseudo, fini, public })
 *     surEvenement(zone, ctx, ev)  événement programmé par le serveur ({ type, donnees })
 *     resultat(zone, details, ctx) détails de l'écran de résultats
 *     formater(public)             texte court pour le fil « qui a joué » (ex. « 🎲 5 »)
 *     demonter()                   nettoyage (minuteurs…)
 *   }
 *   ctx = { etat, tour, public, moi, peutJouer, monAction, agir(donnees), maintenant(), pseudo(id), vue }
 */
(async () => {
  const { $, $$, echapper, h, toast } = LW;
  const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  if (!code) { location.href = '/accueil'; return; }

  const moi = await LW.session();
  LW.barre('');
  $('#code').textContent = code;
  document.title = `Last War Arène — Salle ${code}`;

  let etat = null;
  let decalage = 0; // horloge serveur - horloge locale
  let cleMontee = null; // tour actuellement affiché
  let moduleMonte = null;
  let minuteurChrono = null;
  let rendreDemande = false;
  const maintenant = () => Date.now() + decalage;

  // ------------------------------------------------------------ connexion temps réel
  const socket = await LW.socket();
  const pastille = $('#connexion');
  const majPastille = (ok) => { pastille.className = `badge ${ok ? 'vert' : 'rouge'}`; pastille.textContent = ok ? '● en ligne' : '● reconnexion…'; };

  async function observer() {
    const rep = await LW.emettre('salle:observer', { code });
    if (!rep.ok) {
      $('#nom-jeu').textContent = 'Salle introuvable';
      $('#scene').innerHTML = `<div class="vide">${echapper(rep.erreur)}<br><br><a class="btn" href="/accueil">Retour à l'accueil</a></div>`;
      return;
    }
    recevoirEtat(rep.etat, true);
  }
  socket.on('connect', () => { majPastille(true); observer(); }); // y compris après une reconnexion
  socket.on('disconnect', () => majPastille(false));
  if (socket.connected) { majPastille(true); observer(); }

  // Chat de la salle (joueurs, éliminés et spectateurs). Replié par défaut sur téléphone.
  LW.chat.monter($('#chat'), `salle:${code}`, { titre: '💬 Chat de la salle', replie: window.innerWidth < 860 });

  socket.on('salle:etat', (e) => { if (e?.code === code) recevoirEtat(e); });
  socket.on('salle:inscription', ({ id, pseudo }) => {
    if (!etat || etat.joueurs.some((j) => j.id === id)) return;
    etat.joueurs.push({ id, pseudo, statut: 'enJeu', tourElimination: null });
    demanderRendu();
  });
  socket.on('salle:desinscription', ({ id, exclu }) => {
    if (!etat) return;
    etat.joueurs = etat.joueurs.filter((j) => j.id !== id);
    if (exclu && id === String(moi.id)) toast('L\'organisateur t\'a retiré de la salle d\'attente.', 'erreur');
    demanderRendu();
  });
  socket.on('jeu:aAgi', (a) => {
    const tc = etat?.tourCourant;
    if (!tc || a.tour !== tc.numero || a.essai !== tc.essai) return;
    const ex = tc.actions.find((x) => x.joueurId === a.joueurId);
    if (ex) Object.assign(ex, { fini: a.fini, public: a.public }); else tc.actions.push({ joueurId: a.joueurId, fini: a.fini, public: a.public });
    ajouterAuFil(a);
    moduleMonte?.surAAgi?.($('#zone-jeu'), contexte(), a);
    majCompteurTour();
    demanderRendu(['joueurs']);
  });
  socket.on('jeu:evenement', (ev) => {
    const tc = etat?.tourCourant;
    if (!tc || ev.tour !== tc.numero || ev.essai !== tc.essai) return;
    tc.evenementsPasses.push({ type: ev.type, donnees: ev.donnees });
    moduleMonte?.surEvenement?.($('#zone-jeu'), contexte(), ev);
  });

  // ------------------------------------------------------------ helpers
  const monJoueur = () => etat?.joueurs.find((j) => j.id === String(moi.id));
  const pseudo = (id) => etat?.joueurs.find((j) => j.id === String(id))?.pseudo || '?';
  const organisateur = LW.peutOrganiser(moi);

  async function chargerModule(id) {
    if (!LW.miniJeux[id]) await LW.chargerScript(`/minijeux/${id}/client.js`);
    return LW.miniJeux[id] || {};
  }

  function contexte() {
    const tc = etat.tourCourant;
    const j = monJoueur();
    return {
      etat, tour: tc, public: tc?.public, moi, vue: etat.vue, maintenant, pseudo,
      peutJouer: !!j && j.statut === 'enJeu' && etat.phase === 'tour' && etat.jeuActif.actionRequise,
      monAction: tc?.actions.find((a) => a.joueurId === String(moi.id)) || null,
      agir: async (donnees) => {
        const rep = await LW.emettre('jeu:action', { code, donnees });
        if (!rep.ok) toast(rep.erreur, 'erreur');
        return rep;
      },
    };
  }

  function demanderRendu() {
    if (rendreDemande) return;
    rendreDemande = true;
    requestAnimationFrame(() => { rendreDemande = false; rendre(); });
  }

  async function recevoirEtat(nouvel, premier = false) {
    decalage = nouvel.maintenant - Date.now();
    const ancienne = etat?.phase;
    etat = nouvel;
    if (etat.phase === 'tour') await chargerModule(etat.jeuActif.id);
    else if (etat.phase === 'resultats' && etat.dernierResultat) await chargerModule(etat.dernierResultat.departage ? '_departage' : etat.miniJeu.id);
    if (!premier && ancienne !== etat.phase && etat.phase === 'termine' && etat.gagnant?.id === String(moi.id)) toast('🏆 Tu as gagné !', 'ok');
    rendre();
  }

  // ------------------------------------------------------------ rendu
  function rendre() {
    if (!etat) return;
    $('#icone').textContent = etat.departage ? '⚡' : etat.miniJeu.icone;
    $('#nom-jeu').textContent = etat.miniJeu.nom + (etat.departage ? ' — mort subite' : '');
    $('#organisateur').textContent = `organisée par ${etat.organisateur.pseudo}`;
    const phases = { attente: ['Salle d\'attente', 'vert'], tour: [`Tour ${etat.tour}${etat.essai ? ' (rejoué)' : ''}`, 'or'], resultats: [`Résultats du tour ${etat.dernierResultat?.tour ?? ''}`, 'or'], termine: [etat.annulee ? 'Arrêtée' : 'Terminée', etat.annulee ? 'rouge' : 'bleu'] };
    const [txt, cls] = phases[etat.phase];
    $('#phase').textContent = txt; $('#phase').className = `badge ${cls}`;
    const enJeu = etat.joueurs.filter((j) => j.statut === 'enJeu').length;
    $('#compteur').textContent = etat.phase === 'attente' ? `${etat.joueurs.length} inscrit(s)` : `${enJeu} / ${etat.joueurs.length} en jeu`;

    rendreBandeau();
    rendreJoueurs();
    rendreOrga();
    rendreScene();
  }

  function rendreBandeau() {
    const j = monJoueur();
    let html = '';
    if (etat.phase !== 'attente' && etat.phase !== 'termine') {
      if (!j) html = '<div class="bandeau spectateur">👀 Tu regardes cette partie en spectateur.</div>';
      else if (j.statut === 'elimine') html = `<div class="bandeau elimine">💀 Tu as été éliminé au tour ${j.tourElimination}. Tu restes en spectateur.</div>`;
    }
    $('#bandeau').innerHTML = html;
  }

  function rendreJoueurs() {
    const tc = etat.tourCourant;
    const actions = new Map((tc?.actions || []).map((a) => [a.joueurId, a]));
    const mod = tc ? LW.miniJeux[etat.jeuActif.id] : null;
    const tries = [...etat.joueurs].sort((a, b) => (a.statut === b.statut ? 0 : a.statut === 'enJeu' ? -1 : 1)
      || (b.tourElimination ?? 0) - (a.tourElimination ?? 0));
    $('#nb-joueurs').textContent = `${etat.joueurs.length}`;
    $('#joueurs').innerHTML = tries.map((j) => {
      const a = actions.get(j.id);
      let val = '';
      if (a) val = a.public != null && mod?.formater ? echapper(mod.formater(a.public, a)) : a.fini ? '✓' : '…';
      else if (j.statut === 'elimine') val = `<span class="muet petit">T${j.tourElimination}</span>`;
      return `<div class="joueur-ligne ${j.statut === 'elimine' ? 'elimine' : ''} ${j.id === String(moi.id) ? 'moi' : ''}">
        <span class="point"></span><span>${echapper(j.pseudo)}</span><span class="val">${val}</span></div>`;
    }).join('') || '<div class="vide petit">Personne pour l\'instant.</div>';
  }

  function rendreOrga() {
    $('#orga').classList.toggle('cache', !organisateur || etat.phase === 'termine');
    if (!organisateur) return;
    const b = [];
    let aide = '';
    if (etat.phase === 'attente') {
      b.push(`<button class="btn principal" data-o="lancer" ${etat.joueurs.length < 2 ? 'disabled' : ''}>▶ Lancer la partie</button>`);
      aide = etat.joueurs.length < 2 ? 'Il faut au moins 2 joueurs inscrits pour lancer.' : 'Une fois lancée, plus personne ne peut rejoindre (sauf en spectateur).';
    } else if (etat.phase === 'tour') {
      b.push('<button class="btn" data-o="suivant">⏭ Terminer le tour maintenant</button>');
      aide = 'Les joueurs qui n\'ont pas joué à la fin du tour sont éliminés.';
    } else if (etat.phase === 'resultats') {
      b.push('<button class="btn principal" data-o="suivant">▶ Tour suivant</button>');
      aide = etat.echeance ? 'Le tour suivant démarre automatiquement.' : 'Mode manuel : lance le tour suivant quand tu veux.';
    }
    b.push('<button class="btn danger" data-o="arreter">■ Arrêter</button>');
    $('#orga-boutons').innerHTML = b.join('');
    $('#orga-aide').textContent = aide;
    $$('#orga-boutons [data-o]').forEach((el) => (el.onclick = async () => {
      const o = el.dataset.o;
      if (o === 'arreter' && !confirm('Arrêter la partie ? Elle sera enregistrée sans gagnant.')) return;
      el.disabled = true;
      const rep = await LW.emettre(`salle:${o}`, { code });
      if (!rep.ok) { toast(rep.erreur, 'erreur'); el.disabled = false; }
    }));
  }

  function arreterChrono() { clearInterval(minuteurChrono); minuteurChrono = null; }
  function demonterModule() {
    try { moduleMonte?.demonter?.(); } catch (e) { console.error(e); }
    moduleMonte = null;
    cleMontee = null;
  }

  function rendreScene() {
    const scene = $('#scene');
    if (etat.phase !== 'tour') { demonterModule(); arreterChrono(); }
    if (etat.phase === 'attente') return sceneAttente(scene);
    if (etat.phase === 'tour') return sceneTour(scene);
    if (etat.phase === 'resultats') return sceneResultats(scene);
    return sceneFin(scene);
  }

  // --- salle d'attente
  function sceneAttente(scene) {
    const inscrit = !!monJoueur();
    const params = Object.entries(etat.params).filter(([k]) => !['avanceAuto', 'pauseResultats', 'toursMax'].includes(k));
    scene.innerHTML = `
      <div class="pile" style="align-items:center;text-align:center;padding:10px 0">
        <div style="font-size:64px">${etat.miniJeu.icone}</div>
        <p class="muet" style="max-width:520px">${echapper(etat.miniJeu.description)}</p>
        <div class="puces" style="justify-content:center">${params.map(([k, v]) => `<span class="badge">${echapper(libelleParam(k))} : <b>${echapper(String(v === true ? 'oui' : v === false ? 'non' : v))}</b></span>`).join('')}</div>
        <div class="grand-texte" style="font-size:3rem;margin-top:10px">${etat.joueurs.length}</div>
        <div class="muet" style="margin-top:-14px">joueur(s) inscrit(s)</div>
        ${inscrit
          ? '<div class="bandeau qualifie" style="margin:8px 0 0">✅ Tu es inscrit. La partie va bientôt commencer…</div><button class="btn lien" id="btn-quitter">Quitter la salle d\'attente</button>'
          : '<button class="btn principal geant" id="btn-rejoindre">⚔ Rejoindre la partie</button>'}
      </div>
      <h3 style="margin-top:18px">Inscrits</h3>
      <div class="puces">${etat.joueurs.map((j) => `<span class="puce ${j.id === String(moi.id) ? 'moi' : ''}">${echapper(j.pseudo)}${organisateur && j.id !== String(moi.id) ? `<button title="Retirer" data-exclure="${j.id}">×</button>` : ''}</span>`).join('') || '<span class="muet">Personne pour l\'instant.</span>'}</div>`;
    $('#btn-rejoindre')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      const rep = await LW.emettre('salle:inscrire', { code });
      if (!rep.ok) { toast(rep.erreur, 'erreur'); e.target.disabled = false; }
    });
    $('#btn-quitter')?.addEventListener('click', async () => {
      const rep = await LW.emettre('salle:quitter', { code });
      if (!rep.ok) toast(rep.erreur, 'erreur');
    });
    $$('[data-exclure]', scene).forEach((b) => (b.onclick = async () => {
      const rep = await LW.emettre('salle:exclure', { code, joueurId: b.dataset.exclure });
      if (!rep.ok) toast(rep.erreur, 'erreur');
    }));
  }

  const LIBELLES = { dureeTour: 'Temps par tour (s)' };
  function libelleParam(k) { return LIBELLES[k] || k.replace(/([A-Z])/g, ' $1').toLowerCase(); }

  // --- tour en cours
  function sceneTour(scene) {
    const tc = etat.tourCourant;
    const cle = `${tc.numero}:${tc.essai}:${etat.jeuActif.id}`;
    const ctx = contexte();
    if (cle !== cleMontee) {
      demonterModule();
      cleMontee = cle;
      moduleMonte = LW.miniJeux[etat.jeuActif.id] || {};
      scene.innerHTML = `
        <div class="ligne espace">
          <h2 style="margin:0">${etat.departage ? '⚡ Mort subite' : `Tour ${tc.numero}`}${tc.essai ? ' <span class="badge rouge">rejoué</span>' : ''}</h2>
          <div class="chrono-texte" id="chrono-texte"></div>
        </div>
        <div class="chrono"><div id="chrono-barre" style="width:100%"></div></div>
        <div class="muet petit" id="compteur-tour"></div>
        ${tc.public?.consigne ? `<div class="consigne">${echapper(tc.public.consigne)}</div>` : ''}
        <div class="zone-jeu" id="zone-jeu"></div>
        <h3 style="margin-top:10px" class="${etat.jeuActif.actionRequise ? '' : 'cache'}">En direct</h3>
        <div class="fil" id="fil"></div>`;
      try { moduleMonte.monter?.($('#zone-jeu'), ctx); } catch (e) { console.error(e); $('#zone-jeu').textContent = 'Erreur d\'affichage du mini-jeu.'; }
      // fil des actions déjà faites (reconnexion)
      for (const a of tc.actions) ajouterAuFil({ ...a, pseudo: pseudo(a.joueurId) });
      // événements déjà passés (reconnexion)
      for (const ev of tc.evenementsPasses) moduleMonte.surEvenement?.($('#zone-jeu'), ctx, { ...ev, rattrapage: true });
      demarrerChrono();
    }
    majCompteurTour();
  }

  function majCompteurTour() {
    const tc = etat?.tourCourant;
    const el = $('#compteur-tour');
    if (!tc || !el) return;
    const enJeu = etat.joueurs.filter((j) => j.statut === 'enJeu').length;
    if (etat.jeuActif.actionRequise) el.textContent = `${tc.actions.filter((a) => a.fini).length} / ${enJeu} joueurs ont joué`;
  }

  function demarrerChrono() {
    arreterChrono();
    const tc = etat.tourCourant;
    const total = tc.finMs - tc.debutMs;
    const tic = () => {
      const reste = Math.max(0, tc.finMs - maintenant());
      const barre = $('#chrono-barre');
      const texte = $('#chrono-texte');
      if (!barre) return arreterChrono();
      barre.style.width = `${(reste / total) * 100}%`;
      barre.style.backgroundPosition = `${(1 - reste / total) * 100}% 0`;
      texte.textContent = `${Math.ceil(reste / 1000)} s`;
      texte.classList.toggle('urgent', reste < 5000 && reste > 0);
    };
    tic();
    minuteurChrono = setInterval(tic, 200);
  }

  const MAX_FIL = 40;
  function ajouterAuFil(a) {
    const fil = $('#fil');
    if (!fil || !a.fini && a.public == null) return;
    const mod = LW.miniJeux[etat.jeuActif.id];
    const txt = a.public != null && mod?.formater ? mod.formater(a.public, a) : 'a joué';
    const ex = fil.querySelector(`[data-j="${a.joueurId}"]`);
    const el = h(`<div class="evt" data-j="${a.joueurId}"><span>${echapper(a.pseudo || pseudo(a.joueurId))}</span><b>${echapper(txt)}</b></div>`);
    if (ex) ex.replaceWith(el); else fil.appendChild(el);
    while (fil.children.length > MAX_FIL) fil.firstElementChild.remove();
  }

  // --- résultats
  function sceneResultats(scene) {
    const r = etat.dernierResultat;
    const moiId = String(moi.id);
    const jeSurvis = r.survivants.includes(moiId);
    const jeSuisElimine = r.elimines.includes(moiId);
    const absents = new Set(r.absents);
    const puces = (ids, cls = '') => ids.map((id) => `<span class="puce ${id === moiId ? 'moi' : ''} ${cls}">${echapper(pseudo(id))}${absents.has(id) ? ' <span class="muet petit">(absent)</span>' : ''}</span>`).join('') || '<span class="muet">—</span>';
    scene.innerHTML = `
      <h2>${r.departage ? '⚡ Mort subite' : `Tour ${r.tour}`} — résultats</h2>
      ${r.message ? `<div class="consigne">${echapper(r.message)}</div>` : ''}
      ${jeSurvis && !r.rejoue ? '<div class="bandeau qualifie">✅ Tu passes au tour suivant !</div>' : ''}
      ${jeSuisElimine ? `<div class="bandeau elimine">💀 Tu es éliminé${absents.has(moiId) ? ' (tu n\'as pas joué à temps)' : ''}.</div>` : ''}
      <div id="details-jeu" class="zone-jeu" style="min-height:0"></div>
      <div class="resultats-listes">
        <div><h3>✅ Qualifiés (${r.survivants.length})</h3><div class="puces">${puces(r.survivants)}</div></div>
        <div><h3>💀 Éliminés (${r.elimines.length})</h3><div class="puces">${puces(r.elimines)}</div></div>
      </div>
      <p class="muet petit" id="prochain" style="text-align:center;margin-top:16px"></p>`;
    const mod = LW.miniJeux[r.departage ? '_departage' : etat.miniJeu.id];
    if (r.details && mod?.resultat) {
      try { mod.resultat($('#details-jeu'), r.details, contexte()); } catch (e) { console.error(e); }
    }
    const prochain = () => {
      const el = $('#prochain');
      if (!el || etat.phase !== 'resultats') return;
      if (etat.echeance) {
        el.textContent = `Tour suivant dans ${Math.max(0, Math.ceil((etat.echeance - maintenant()) / 1000))} s…`;
        setTimeout(prochain, 250);
      } else el.textContent = 'En attente de l\'organisateur pour le tour suivant.';
    };
    prochain();
  }

  // --- fin de partie
  function sceneFin(scene) {
    if (etat.annulee) {
      scene.innerHTML = '<div class="gagnant"><div class="trophee" style="animation:none">🛑</div><h2>Partie arrêtée par l\'organisateur</h2><a class="btn" href="/accueil">Retour à l\'accueil</a></div>';
      return;
    }
    const g = etat.gagnant;
    if (scene.dataset.fin === g.id) return; // déjà affiché (évite de relancer les confettis)
    scene.dataset.fin = g.id;
    const moiGagne = g.id === String(moi.id);
    scene.innerHTML = `<div class="gagnant">
      <div class="trophee">🏆</div>
      <div class="muet" style="text-transform:uppercase;letter-spacing:.2em;margin-top:10px">${moiGagne ? 'Victoire !' : 'Le grand gagnant est'}</div>
      <div class="nom">${echapper(g.pseudo)}</div>
      <p class="muet">${etat.miniJeu.icone} ${echapper(etat.miniJeu.nom)} · ${etat.joueurs.length} joueurs · ${etat.tour} tours</p>
      <div class="ligne" style="justify-content:center;margin-top:16px"><a class="btn principal" href="/accueil">Retour à l'accueil</a><a class="btn" href="/historique">Historique</a></div>
    </div>`;
    confettis(scene);
  }

  function confettis(conteneur) {
    const couleurs = ['#f5a524', '#ffc35a', '#3fbf6f', '#4ea1ff', '#ef4b4b', '#ffffff'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = couleurs[i % couleurs.length];
      c.style.animationDuration = `${2.5 + Math.random() * 2.5}s`;
      c.style.animationDelay = `${Math.random() * 1.5}s`;
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      conteneur.appendChild(c);
      setTimeout(() => c.remove(), 7000);
    }
  }
})();
