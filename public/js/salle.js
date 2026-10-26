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
  // « Rejoindre » depuis l'accueil : inscription automatique en arrivant (une seule fois, l'URL est nettoyée)
  let rejoindreAuto = new URLSearchParams(location.search).get('rejoindre') === '1';
  if (rejoindreAuto) history.replaceState(null, '', `/salle?code=${encodeURIComponent(code)}`);
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
    if (rejoindreAuto) {
      rejoindreAuto = false;
      if (etat.phase === 'attente' && !monJoueur()) {
        const r = await LW.emettre('salle:inscrire', { code });
        if (!r.ok) toast(r.erreur, 'erreur');
      }
    }
  }
  socket.on('connect', () => { majPastille(true); observer(); }); // y compris après une reconnexion
  socket.on('disconnect', () => majPastille(false));
  if (socket.connected) { majPastille(true); observer(); }

  // Chat de la salle (joueurs, éliminés et spectateurs). Replié par défaut sur téléphone.
  LW.chat.monter($('#chat'), `salle:${code}`, { titre: '💬 Chat de la salle', replie: window.innerWidth < 860 });

  socket.on('salle:etat', (e) => { if (e?.code === code) recevoirEtat(e); });
  socket.on('salle:inscription', ({ id, pseudo }) => {
    if (!etat || etat.joueurs.some((j) => j.id === id)) return;
    etat.joueurs.push({ id, pseudo, statut: 'enJeu', tourElimination: null, pret: false });
    demanderRendu();
  });
  socket.on('salle:pret', ({ id, pret }) => {
    const j = etat?.joueurs.find((x) => x.id === id);
    if (!j) return;
    j.pret = pret;
    demanderRendu();
  });
  socket.on('salle:alerte', ({ par }) => {
    if (etat?.phase !== 'attente') return;
    LW.son.alerte();
    const j = monJoueur();
    toast(!j ? `🔔 ${par} appelle les joueurs : la partie va commencer, rejoins-la !`
      : j.pret ? `🔔 ${par} : la partie va commencer !` : `🔔 ${par} : la partie va commencer, active « Prêt » à côté de ton nom !`);
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
  const nbPrets = () => etat.joueurs.filter((j) => j.pret).length;
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
    else if (etat.phase === 'attente' && organisateur) await chargerModule(etat.miniJeu.id); // réglages éventuels du mini-jeu
    else if (etat.phase === 'resultats' && etat.dernierResultat) await chargerModule(etat.dernierResultat.departage ? '_departage' : etat.miniJeu.id);
    if (!premier && ancienne !== etat.phase && etat.phase === 'termine' && etat.gagnant?.id === String(moi.id)) toast('🏆 Tu as gagné !', 'ok');
    if (!premier && ancienne === 'attente' && etat.phase === 'tour' && monJoueur()) LW.son.depart();
    rendre();
  }

  // ------------------------------------------------------------ rendu
  function rendre() {
    if (!etat) return;
    $('#icone').textContent = etat.departage ? '⚡' : etat.miniJeu.icone;
    $('#nom-jeu').textContent = etat.miniJeu.nom + (etat.departage ? ' — mort subite' : '');
    $('#organisateur').innerHTML = `${LW.badgeObjet(etat.objet, { long: true, date: etat.dateObjet })} organisée par ${echapper(etat.organisateur.pseudo)}`;
    const phases = { attente: ['Salle d\'attente', 'vert'], tour: [`Tour ${etat.tour}${etat.essai ? ' (rejoué)' : ''}`, 'or'], resultats: [`Résultats du tour ${etat.dernierResultat?.tour ?? ''}`, 'or'], termine: [etat.annulee ? 'Arrêtée' : 'Terminée', etat.annulee ? 'rouge' : 'bleu'] };
    const [txt, cls] = phases[etat.phase];
    $('#phase').textContent = txt; $('#phase').className = `badge ${cls}`;
    const enJeu = etat.joueurs.filter((j) => j.statut === 'enJeu').length;
    $('#compteur').textContent = etat.phase === 'attente' ? `${nbPrets()} / ${etat.joueurs.length} prêt(s)` : `${enJeu} / ${etat.joueurs.length} en jeu`;

    rendreBandeau();
    rendreJoueurs();
    rendreOrga();
    rendreScene();
  }

  /** Interrupteur « Prêt » sur sa propre ligne de la liste des joueurs (la liste est redessinée : délégation). */
  let pretEnCours = false;
  $('#joueurs').addEventListener('change', async (e) => {
    if (e.target.id !== 'chk-pret') return;
    const voulu = e.target.checked;
    pretEnCours = true;
    e.target.disabled = true;
    const rep = await LW.emettre('salle:pret', { code, pret: voulu });
    pretEnCours = false;
    if (!rep.ok) toast(rep.erreur, 'erreur');
    rendreJoueurs();
  });
  $('#joueurs').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-exclure]');
    if (!b) return;
    if (!confirm(`Exclure ${b.dataset.pseudo} de la salle d'attente ?`)) return;
    b.disabled = true;
    const rep = await LW.emettre('salle:exclure', { code, joueurId: b.dataset.exclure });
    if (!rep.ok) { toast(rep.erreur, 'erreur'); b.disabled = false; }
  });

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
      if (etat.phase === 'attente' && j.id === String(moi.id)) {
        val = `<label class="interrupteur mini" title="Indique à l'organisateur que tu es prêt à jouer">
          <span class="lib">${j.pret ? 'Prêt' : 'Pas prêt'}</span><input type="checkbox" id="chk-pret" ${j.pret ? 'checked' : ''} ${pretEnCours ? 'disabled' : ''}><span class="glissiere"></span></label>`;
      } else if (etat.phase === 'attente') {
        val = j.pret ? '<span class="pret-oui">✅ prêt</span>' : '<span class="pret-non">⏳ pas prêt</span>';
        if (organisateur && !j.pret) val += `<button class="btn-exclure" title="Exclure de la salle" data-exclure="${j.id}" data-pseudo="${echapper(j.pseudo)}">✕</button>`;
      }
      else if (a) val = a.public != null && mod?.formater ? echapper(mod.formater(a.public, a)) : a.fini ? '✓' : '…';
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
      const n = etat.joueurs.length;
      const prets = nbPrets();
      b.push('<button class="btn" data-o="alerter" title="Fait sonner une alerte chez tous les joueurs de la salle">🔔 Appeler les joueurs</button>');
      b.push(`<button class="btn principal" data-o="lancer" ${n < 2 || prets < n ? 'disabled' : ''}>▶ Lancer la partie</button>`);
      aide = n < 2 ? 'Il faut au moins 2 joueurs inscrits pour lancer.'
        : prets < n ? `${prets} / ${n} joueurs prêts. La partie pourra être lancée quand tout le monde sera prêt. Exclus avec ✕ (liste des joueurs) ceux qui ne répondent pas.`
          : 'Tout le monde est prêt ! Une fois lancée, plus personne ne peut rejoindre (sauf en spectateur).';
    } else if (etat.phase === 'tour') {
      b.push('<button class="btn" data-o="suivant">⏭ Terminer le tour maintenant</button>');
      aide = 'Les joueurs qui n\'ont pas joué à la fin du tour sont éliminés.';
    } else if (etat.phase === 'resultats') {
      if (etat.dernierResultat?.final) {
        b.push('<button class="btn principal" data-o="suivant">🏆 Annoncer le gagnant</button>');
        aide = 'Le gagnant est annoncé automatiquement à la fin du compte à rebours.';
      } else {
        b.push('<button class="btn principal" data-o="suivant">▶ Tour suivant</button>');
        aide = etat.echeance ? 'Le tour suivant démarre automatiquement.' : 'Mode manuel : lance le tour suivant quand tu veux.';
      }
    }
    b.push('<button class="btn danger" data-o="arreter">■ Arrêter</button>');
    $('#orga-boutons').innerHTML = b.join('');
    $('#orga-aide').textContent = aide;
    rendreReglagesJeu();
    $$('#orga-boutons [data-o]').forEach((el) => (el.onclick = async () => {
      const o = el.dataset.o;
      if (o === 'arreter' && !confirm('Arrêter la partie ? Elle sera enregistrée sans gagnant.')) return;
      el.disabled = true;
      const rep = await LW.emettre(`salle:${o}`, { code });
      if (!rep.ok) { toast(rep.erreur, 'erreur'); el.disabled = false; }
      else if (o === 'alerter') { toast('🔔 Alerte envoyée à tous les joueurs de la salle.', 'ok'); setTimeout(() => { el.disabled = false; }, 10000); }
    }));
  }

  /**
   * Réglages du mini-jeu pour le prochain tour (ex. options A / B de « La minorité »), fournis par
   * LW.miniJeux[id].orga(zone, ctx). Redessinés seulement quand ils changent (pour ne pas effacer la saisie).
   */
  function rendreReglagesJeu() {
    const zone = $('#orga-jeu');
    const mod = LW.miniJeux[etat.miniJeu.id];
    const cle = etat.peutRegler && mod?.orga ? `${etat.phase}:${etat.prochainTour}:${JSON.stringify(etat.reglagesOrga)}` : '';
    if (zone.dataset.cle === cle) return;
    zone.dataset.cle = cle;
    zone.innerHTML = '';
    if (!cle) return;
    try {
      mod.orga(zone, {
        etat, moi, pseudo,
        envoyer: async (donnees) => {
          const rep = await LW.emettre('jeu:orga', { code, donnees });
          toast(rep.ok ? '✅ Réglage enregistré pour le prochain tour.' : rep.erreur, rep.ok ? 'ok' : 'erreur');
          return rep;
        },
      });
    } catch (e) { console.error(e); }
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
    if (etat.phase !== 'resultats') { delete scene.dataset.resultats; clearTimeout(minuteurRevelation); }
    if (etat.phase === 'attente') return sceneAttente(scene);
    if (etat.phase === 'tour') return sceneTour(scene);
    if (etat.phase === 'resultats') return sceneResultats(scene);
    return sceneFin(scene);
  }

  // --- salle d'attente
  function sceneAttente(scene) {
    const inscrit = !!monJoueur();
    const n = etat.joueurs.length;
    const prets = nbPrets();
    const params = Object.entries(etat.params).filter(([k]) => !['avanceAuto', 'pauseResultats', 'toursMax'].includes(k));
    scene.innerHTML = `
      ${inscrit ? '<div class="ligne"><button class="btn lien petit" id="btn-quitter">← Quitter la salle d\'attente</button></div>' : ''}
      <div class="pile" style="align-items:center;text-align:center;padding:10px 0">
        <div style="font-size:64px">${etat.miniJeu.icone}</div>
        <p class="muet" style="max-width:520px;margin-bottom:0">${echapper(etat.miniJeu.description)}</p>
        <div class="puces" style="justify-content:center">${params.filter(([, v]) => v !== '').map(([k, v]) => `<span class="badge">${echapper(libelleParam(k))} : <b>${echapper(String(v === true ? 'oui' : v === false ? 'non' : String(v).includes('\n') || String(v).length > 40 ? `${String(v).split('\n').filter((l) => l.trim()).length} tour(s) préparé(s)` : v))}</b></span>`).join('')}</div>
        <div class="grand-texte" style="font-size:3rem;margin-top:10px">${prets} / ${n}</div>
        <div class="muet" style="margin-top:-14px">joueur(s) prêt(s)</div>
        ${inscrit ? '' : '<button class="btn principal geant" id="btn-rejoindre">⚔ Rejoindre la partie</button>'}
      </div>
      ${blocRegles()}
      <div class="puces" style="margin-top:18px">${etat.joueurs.map((x) => `<span class="puce ${x.id === String(moi.id) ? 'moi' : ''} ${x.pret ? 'pret' : 'pas-pret'}">${x.pret ? '✅' : '⏳'} ${echapper(x.pseudo)}</span>`).join('') || '<span class="muet">Personne pour l\'instant.</span>'}</div>`;
    const regles = $('.regles', scene);
    if (regles) { regles.open = reglesOuvertes; regles.ontoggle = () => { reglesOuvertes = regles.open; }; }
    $('#btn-rejoindre')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      const rep = await LW.emettre('salle:inscrire', { code });
      if (!rep.ok) { toast(rep.erreur, 'erreur'); e.target.disabled = false; }
    });
    $('#btn-quitter')?.addEventListener('click', async () => {
      const rep = await LW.emettre('salle:quitter', { code });
      if (!rep.ok) toast(rep.erreur, 'erreur');
    });
  }

  let reglesOuvertes = true; // garde l'état replié / déplié quand la salle d'attente se redessine
  /** Règles du jeu choisi + règles communes, pour ceux qui ne connaissent pas encore le jeu. */
  function blocRegles() {
    const m = etat.miniJeu;
    const o = LW.objets[etat.objet];
    const communes = [
      m.actionRequise ? `⏱ Joue avant la fin du chrono (${etat.params.dureeTour} s par tour) : si tu ne joues pas, tu es éliminé.` : null,
      '👀 Éliminé ? Tu restes en spectateur jusqu\'à la fin de la partie.',
      `🏆 Le dernier survivant gagne${o ? ` et sera <b>${o.long}</b>${etat.dateObjet ? ` le <b>${LW.jour(etat.dateObjet)}</b>` : ''}` : ''}. La finale se joue toujours à 2 au minimum.`,
      '⚡ Égalité impossible à départager ? Mort subite : chacun tire un nombre de 1 à 1000, le plus haut gagne.',
    ].filter(Boolean);
    return `<details class="regles" open>
      <summary>📖 Règles du jeu : ${m.icone} ${echapper(m.nom)}</summary>
      <ol>${(m.regles || [m.description]).map((r) => `<li>${echapper(r)}</li>`).join('')}</ol>
      <div class="regles-communes">${communes.map((r) => `<div>${r}</div>`).join('')}</div>
    </details>`;
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
      // éliminé ou simple spectateur dans un jeu où il faut agir : la zone de jeu n'est pas cliquable
      const spectateur = !ctx.peutJouer && etat.jeuActif.actionRequise;
      moduleMonte = LW.miniJeux[etat.jeuActif.id] || {};
      scene.innerHTML = `
        <div class="ligne espace">
          <h2 style="margin:0">${etat.departage ? '⚡ Mort subite' : `Tour ${tc.numero}`}${tc.essai ? ' <span class="badge rouge">rejoué</span>' : ''}</h2>
          <div class="chrono-texte" id="chrono-texte"></div>
        </div>
        <div class="chrono"><div id="chrono-barre" style="width:100%"></div></div>
        <div class="muet petit" id="compteur-tour"></div>
        ${tc.public?.consigne ? `<div class="consigne">${echapper(tc.public.consigne)}</div>` : ''}
        ${spectateur ? `<div class="etiquette-spectateur">👀 Mode spectateur${monJoueur()?.statut === 'elimine' ? ' : tu as été éliminé, tu ne peux plus jouer' : ''}</div>` : ''}
        ${ctx.peutJouer ? '<div class="rappel-absent" id="rappel-absent">⏱ Joue avant la fin du chrono : si tu ne joues pas (aucun choix), tu es éliminé.</div>' : ''}
        <div class="zone-jeu ${spectateur ? 'spectateur' : ''}" id="zone-jeu"></div>
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
    // le rappel « joue sinon tu es éliminé » disparaît dès que j'ai joué
    const aJoue = tc.actions.some((a) => a.joueurId === String(moi.id) && a.fini);
    $('#rappel-absent')?.classList.toggle('cache', aJoue);
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
      $('#rappel-absent')?.classList.toggle('urgent', reste < 5000);
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
  let minuteurRevelation = null;
  function sceneResultats(scene) {
    const r = etat.dernierResultat;
    const cle = `${r.tour}:${r.essai}:${r.departage}`;
    if (scene.dataset.resultats === cle) return; // déjà affiché : ne pas relancer l'animation
    scene.dataset.resultats = cle;
    clearTimeout(minuteurRevelation);

    const moiId = String(moi.id);
    const jeSurvis = r.survivants.includes(moiId);
    const jeSuisElimine = r.elimines.includes(moiId);
    const absents = new Set(r.absents);
    const gagnantId = r.final ? r.survivants[0] : null;
    // Temps de révélation (ex. cartes retournées une à une) : messages et listes n'apparaissent qu'après.
    const revelationMs = r.details?.revelationMs || 0;
    const ecouleMs = Math.max(0, maintenant() - (r.resoluLe || 0));
    const resteMs = Math.max(0, revelationMs - ecouleMs);
    const puces = (ids, cls = '') => ids.map((id) => `<span class="puce ${id === moiId ? 'moi' : ''} ${cls}">${echapper(pseudo(id))}${absents.has(id) ? ' <span class="muet petit">(absent)</span>' : ''}</span>`).join('') || '<span class="muet">—</span>';
    scene.innerHTML = `
      <h2>${r.departage ? '⚡ Mort subite' : `Tour ${r.tour}`} — ${r.final ? 'manche décisive' : 'résultats'}</h2>
      <div class="apres-revelation">
        ${r.message ? `<div class="consigne">${echapper(r.message)}</div>` : ''}
        ${gagnantId ? `<div class="bandeau qualifie">🏆 ${gagnantId === moiId ? 'Tu remportes la partie !' : `${echapper(pseudo(gagnantId))} remporte la partie !`}</div>`
          : jeSurvis && !r.rejoue ? '<div class="bandeau qualifie">✅ Tu passes au tour suivant !</div>' : ''}
        ${jeSuisElimine ? `<div class="bandeau elimine">💀 Tu es éliminé${absents.has(moiId) ? ' (tu n\'as pas joué à temps)' : ''}.</div>` : ''}
      </div>
      ${resteMs > 0 ? '<p class="muet petit suspense" style="text-align:center">Révélation en cours…</p>' : ''}
      <div id="details-jeu" class="zone-jeu" style="min-height:0"></div>
      <div class="resultats-listes apres-revelation">
        <div><h3>${gagnantId ? '🏆 Gagnant' : `✅ Qualifiés (${r.survivants.length})`}</h3><div class="puces">${puces(r.survivants)}</div></div>
        <div><h3>💀 Éliminés (${r.elimines.length})</h3><div class="puces">${puces(r.elimines)}</div></div>
      </div>
      <p class="muet petit" id="prochain" style="text-align:center;margin-top:16px"></p>`;
    const mod = LW.miniJeux[r.departage ? '_departage' : etat.miniJeu.id];
    if (r.details && mod?.resultat) {
      try { mod.resultat($('#details-jeu'), r.details, { ...contexte(), revelation: { ecouleMs, resteMs } }); } catch (e) { console.error(e); }
    }
    const blocs = $$('.apres-revelation', scene);
    if (resteMs > 0) {
      blocs.forEach((b) => b.classList.add('masque'));
      minuteurRevelation = setTimeout(() => {
        blocs.forEach((b) => { b.classList.remove('masque'); b.classList.add('apparait'); });
        $('.suspense', scene)?.remove();
      }, resteMs);
    }
    const prochain = () => {
      const el = $('#prochain');
      if (!el || etat.phase !== 'resultats' || etat.dernierResultat?.resoluLe !== r.resoluLe) return;
      if (etat.echeance) {
        const s = Math.max(0, Math.ceil((etat.echeance - maintenant()) / 1000));
        el.textContent = r.final ? `Annonce du gagnant dans ${s} s…` : `Tour suivant dans ${s} s…`;
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
      <div class="muet" style="text-transform:uppercase;letter-spacing:.2em;margin-top:10px">${moiGagne ? 'Victoire !' : LW.objets[etat.objet] ? `${LW.objets[etat.objet].long} le ${LW.jour(etat.dateObjet)}` : 'Le grand gagnant est'}</div>
      <div class="nom">${echapper(g.pseudo)}</div>
      ${moiGagne && LW.objets[etat.objet] ? `<p style="font-size:1.2rem;margin:4px 0">${LW.objets[etat.objet].icone} Tu seras <b>${LW.objets[etat.objet].long}</b> le <b>${LW.jour(etat.dateObjet)}</b> !</p>` : ''}
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
