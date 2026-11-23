/**
 * Loup-Garou — affichage dans la salle (le serveur garde les rôles ; on n'affiche que la vue publique
 * et la vue privée envoyée à ce joueur seul).
 */
(function () {
  const { echapper } = LW;
  const NUIT = ['distribution', 'nuit'];
  const CAMPS = { village: '🧑‍🌾 Villageois', loups: '🐺 Loups-Garous', amoureux: '💘 Amoureux', egalite: '☠️ Égalité' };
  const TITRES_ACTION = {
    cupidon: ['💘 Choisis deux amoureux', 'Ils se connaîtront. Si l\'un meurt, l\'autre meurt de chagrin. Tu peux te choisir.'],
    salvateur: ['🛡️ Qui protèges-tu cette nuit ?', 'Le joueur protégé ne peut pas être dévoré par les loups. Pas la même personne que la nuit dernière.'],
    voyante: ['🔮 Quel joueur veux-tu sonder ?', 'Tu découvriras son rôle. Toi seule le verras.'],
    loups: ['🐺 Choisissez votre victime', 'Votez ensemble (salon 🐺 Loups du chat pour vous mettre d\'accord). Le plus de voix est dévoré ; égalité = tirage au sort.'],
    sorciere: ['🧪 Tes potions', 'Chaque potion ne sert qu\'une fois dans la partie.'],
    vote: ['🗳️ Vote du village', 'Vote pour éliminer un joueur. Tu peux changer d\'avis jusqu\'à la fin du minuteur.'],
    chasseur: ['🏹 Tu es mort : qui emportes-tu ?', 'Tu as 30 secondes. Si tu ne choisis personne, tu ne tires sur personne.'],
  };

  // état local de l'affichage (sélections en cours, sons déjà joués…)
  let selection = { cle: null, ids: [], poison: false };
  let precedent = { phase: null, etape: null, numero: 0, cleAction: null, morts: 0 };
  let carteOuverte = false;
  let derniersSalons = '';
  let dernierHtml = '';
  let minuteur = null;
  let ctxCourant = null;
  let defilerVersAction = false; // mon tour arrive : on ramène l'action à l'écran (téléphone)

  const nom = (ctx, id) => ctx.vue.joueurs.find((j) => j.id === id)?.pseudo || '?';
  const roleTxt = (r) => (r ? `${r.icone} ${r.nom}` : '');
  const ROLES_PUBLICS = {
    LOUP: { icone: '🐺', nom: 'Loup-Garou' }, VILLAGEOIS: { icone: '🧑‍🌾', nom: 'Simple Villageois' }, VOYANTE: { icone: '🔮', nom: 'Voyante' },
    SORCIERE: { icone: '🧪', nom: 'Sorcière' }, CHASSEUR: { icone: '🏹', nom: 'Chasseur' }, CUPIDON: { icone: '💘', nom: 'Cupidon' }, SALVATEUR: { icone: '🛡️', nom: 'Salvateur' },
  };
  const rolePublic = (id) => (id ? ROLES_PUBLICS[id] : null);
  const enJeu = (ctx) => ctx.etat.phase === 'jeu';
  const fini = (ctx) => ctx.etat.phase === 'termine';

  function libellePhase(ctx) {
    const v = ctx.vue;
    if (!v) return 'Loup-Garou';
    if (fini(ctx)) return 'Partie terminée';
    if (v.phase === 'distribution') return '🃏 Distribution';
    return NUIT.includes(v.phase) ? `🌙 Nuit ${v.numero}` : `☀️ Jour ${v.numero}`;
  }

  // ------------------------------------------------------------------ morceaux d'écran

  function carteRole(ctx, grande = false) {
    const p = ctx.prive;
    if (!p) return '';
    const r = p.role;
    const extras = [];
    if (p.loups) extras.push(`<div><b>🐺 Ta meute :</b> ${p.loups.map((l) => `${echapper(l.pseudo)}${l.vivant ? '' : ' ✝'}`).join(', ')}</div>`);
    if (p.partenaire) extras.push(`<div><b>💘 Ton amoureux :</b> ${echapper(p.partenaire.pseudo)}${p.partenaire.vivant ? '' : ' ✝'} — si l'un meurt, l'autre aussi.</div>`);
    if (p.amoureux) extras.push(`<div><b>💘 Tes amoureux :</b> ${p.amoureux.map((a) => echapper(a.pseudo)).join(' & ')}</div>`);
    if (p.potions) extras.push(`<div><b>Potions :</b> ${p.potions.vie ? '🧪 vie' : '<s>vie</s>'} · ${p.potions.mort ? '☠️ mort' : '<s>mort</s>'}</div>`);
    if (p.dernierProtege) extras.push(`<div><b>🛡️ Protégé la nuit dernière :</b> ${echapper(p.dernierProtege.pseudo)} (pas deux fois de suite)</div>`);
    if (p.visions?.length) extras.push(`<div><b>🔮 Tes visions :</b><ul class="lg-visions">${p.visions.map((v) => `<li>Nuit ${v.nuit} : ${echapper(v.pseudo)} est <b>${roleTxt(v.role)}</b></li>`).join('')}</ul></div>`);
    return `<div class="lg-carte ${r.camp} ${grande ? 'grande' : ''}">
      <div class="lg-carte-image">${r.icone}</div>
      <div class="lg-carte-texte">
        <div class="lg-carte-titre">${p.vivant ? 'Tu es' : 'Tu étais'} <b>${echapper(r.nom)}</b></div>
        <div class="lg-carte-camp">${r.camp === 'loups' ? 'Camp des loups' : 'Camp du village'}</div>
        <p>${echapper(r.description)}</p>
        ${extras.length ? `<div class="lg-infos">${extras.join('')}</div>` : ''}
      </div></div>`;
  }

  function chrono(ctx) {
    const v = ctx.vue;
    if (!v?.finMs || fini(ctx)) return '';
    return `<div class="lg-chrono" data-fin="${v.finMs}"></div>`;
  }

  /** Grille de joueurs à choisir. */
  function grille(ctx, ids, { choisis = [], compte = null, desactive = false } = {}) {
    if (!ids.length) return '<div class="vide petit">Personne à choisir.</div>';
    return `<div class="lg-cibles">${ids.map((id) => {
      const n = compte?.get(id) || [];
      return `<button type="button" class="lg-cible ${choisis.includes(id) ? 'choisie' : ''}" data-cible="${id}" ${desactive ? 'disabled' : ''}>
        <span class="lg-cible-nom">${echapper(nom(ctx, id))}${id === String(ctx.moi.id) ? ' <span class="muet petit">(toi)</span>' : ''}</span>
        ${n.length ? `<span class="lg-cible-votes" title="${echapper(n.map((x) => nom(ctx, x)).join(', '))}">${n.length} 🗳 <span class="petit">${echapper(n.map((x) => nom(ctx, x)).join(', '))}</span></span>` : ''}
      </button>`;
    }).join('')}</div>`;
  }
  const comptage = (votes) => {
    const m = new Map();
    for (const { de, pour } of votes || []) { if (!m.has(pour)) m.set(pour, []); m.get(pour).push(de); }
    return m;
  };

  function panneauAction(ctx) {
    const a = ctx.prive?.action;
    if (!a) return '';
    const [titre, aide] = TITRES_ACTION[a.type] || ['', ''];
    const cle = `${a.type}:${ctx.vue.numero}:${ctx.vue.phase}`;
    if (selection.cle !== cle) selection = { cle, ids: [], poison: false };
    let corps = '';
    switch (a.type) {
      case 'cupidon':
        corps = `${grille(ctx, a.cibles, { choisis: selection.ids })}
          <button class="btn principal geant lg-valider" data-faire="cupidon" ${selection.ids.length === 2 ? '' : 'disabled'}>💘 Unir ${selection.ids.length === 2 ? `${echapper(nom(ctx, selection.ids[0]))} & ${echapper(nom(ctx, selection.ids[1]))}` : '(choisis 2 joueurs)'}</button>`;
        break;
      case 'salvateur': case 'voyante':
        corps = `${a.interdit ? `<p class="muet petit">Interdit cette nuit : ${echapper(nom(ctx, a.interdit))} (protégé la nuit dernière).</p>` : ''}
          ${grille(ctx, a.cibles, { choisis: selection.ids })}
          <button class="btn principal geant lg-valider" data-faire="${a.type}" ${selection.ids.length === 1 ? '' : 'disabled'}>${a.type === 'voyante' ? '🔮 Sonder' : '🛡️ Protéger'} ${selection.ids[0] ? echapper(nom(ctx, selection.ids[0])) : '…'}</button>`;
        break;
      case 'loups':
        corps = `${grille(ctx, a.cibles, { choisis: a.choix ? [a.choix] : [], compte: comptage(a.votes) })}
          <p class="muet petit">${a.choix ? `Ton vote : <b>${echapper(nom(ctx, a.choix))}</b>. ` : ''}Dès que tous les loups vivants votent pour la même victime, la nuit continue.</p>`;
        break;
      case 'sorciere': {
        const victime = a.victime ? `<div class="lg-victime">🩸 Les loups ont choisi : <b>${echapper(nom(ctx, a.victime))}</b>${a.victime === String(ctx.moi.id) ? ' (toi !)' : ''}</div>`
          : '<div class="lg-victime">🌙 Les loups n\'ont fait aucune victime cette nuit.</div>';
        const boutons = [];
        if (a.sauve) boutons.push(`<span class="badge vert">🧪 Tu sauves ${echapper(nom(ctx, a.victime))}</span>`);
        else if (a.peutSauver) boutons.push(`<button class="btn succes" data-faire="vie">🧪 Sauver ${echapper(nom(ctx, a.victime))}</button>`);
        else if (a.victime === String(ctx.moi.id) && a.potions.vie) boutons.push('<span class="muet petit">Tu ne peux pas te sauver toi-même.</span>');
        if (a.tue) boutons.push(`<span class="badge rouge">☠️ Tu empoisonnes ${echapper(nom(ctx, a.tue))}</span>`);
        else if (a.potions.mort) boutons.push(`<button class="btn danger" data-faire="poison">☠️ ${selection.poison ? 'Annuler le poison' : 'Utiliser la potion de mort…'}</button>`);
        corps = `${victime}<div class="ligne" style="gap:8px;margin:10px 0">${boutons.join('') || '<span class="muet">Plus de potion disponible.</span>'}</div>
          ${selection.poison && !a.tue ? `<p class="muet petit">Qui veux-tu empoisonner ?</p>${grille(ctx, a.cibles, { choisis: selection.ids })}
            <button class="btn danger lg-valider" data-faire="mort" ${selection.ids.length === 1 ? '' : 'disabled'}>☠️ Empoisonner ${selection.ids[0] ? echapper(nom(ctx, selection.ids[0])) : '…'}</button>` : ''}
          <button class="btn principal geant lg-valider" data-faire="terminer">😴 Terminer et me rendormir</button>`;
        break;
      }
      case 'vote':
        corps = `${grille(ctx, a.cibles, { choisis: a.choix ? [a.choix] : [], compte: comptage(ctx.vue.vote?.votes) })}
          <p class="muet petit">${a.choix ? `Ton vote : <b>${echapper(nom(ctx, a.choix))}</b> (touche-le encore pour le retirer).` : 'Tu n\'as pas encore voté (sans vote = abstention).'}</p>`;
        break;
      case 'chasseur':
        corps = `${grille(ctx, a.cibles, { choisis: selection.ids })}
          <button class="btn danger geant lg-valider" data-faire="chasseur" ${selection.ids.length === 1 ? '' : 'disabled'}>🏹 Tirer sur ${selection.ids[0] ? echapper(nom(ctx, selection.ids[0])) : '…'}</button>`;
        break;
      default:
    }
    return `<div class="lg-action"><div class="ligne espace"><h3 style="margin:0">${titre}</h3>${chrono(ctx)}</div>
      <p class="muet petit" style="margin:4px 0 10px">${aide}</p>${corps}</div>`;
  }

  function annonces(ctx) {
    const a = ctx.vue.annonces;
    if (!a) return '';
    const votes = ctx.vue.votesFinaux;
    return `<div class="lg-annonces">
      ${a.morts.map((m) => `<div class="lg-mort"><span class="lg-mort-ic">${m.role ? rolePublic(m.role).icone : '💀'}</span><span>${echapper(m.texte)}</span></div>`).join('')}
      ${a.messages.map((m) => `<div class="lg-message">${echapper(m)}</div>`).join('')}
      ${votes?.length ? `<details class="lg-votes-finaux"><summary>Détail des votes (${votes.length})</summary>${votes.map((x) => `<div>${echapper(nom(ctx, x.de))} → ${echapper(nom(ctx, x.pour))}</div>`).join('')}</details>` : ''}
    </div>`;
  }

  function voteSpectateur(ctx) {
    const v = ctx.vue.vote;
    if (!v || ctx.prive?.action) return '';
    const m = comptage(v.votes);
    const ids = v.candidats || ctx.vue.joueurs.filter((j) => j.vivant).map((j) => j.id);
    return `<div class="lg-action"><div class="ligne espace"><h3 style="margin:0">🗳️ Votes en direct</h3>${chrono(ctx)}</div>${grille(ctx, ids, { compte: m, desactive: true })}</div>`;
  }

  function ecranFin(ctx) {
    const f = ctx.vue.fin;
    if (!f) return '<div class="vide">Partie terminée.</div>';
    const gagne = f.gagnants.includes(String(ctx.moi.id));
    return `<div class="lg-fin">
      <div class="lg-fin-titre">${echapper(f.libelle)}</div>
      ${ctx.prive ? `<div class="lg-fin-moi ${gagne ? 'gagne' : ''}">${gagne ? '🏆 Victoire ! Tu fais partie des gagnants.' : 'Défaite… Ce sera pour la prochaine fois !'}</div>` : ''}
      <h3>Les rôles</h3>
      <div class="lg-roles">${f.roles.map((r) => `<div class="lg-role-ligne ${r.vivant ? '' : 'mort'} ${f.gagnants.includes(r.id) ? 'gagnant' : ''}">
        <span>${rolePublic(r.role).icone}</span><b>${echapper(r.pseudo)}</b><span class="muet">${rolePublic(r.role).nom}${r.amoureux ? ' 💘' : ''}</span>
        <span class="petit">${f.gagnants.includes(r.id) ? '🏆' : ''}${r.vivant ? '' : ' ✝'}</span></div>`).join('')}</div>
      <h3>Résumé de la partie</h3>
      <ol class="lg-resume">${f.resume.map((m) => `<li><b>${echapper(m.quand)}</b> — ${echapper(m.pseudo)} (${rolePublic(m.role).icone} ${rolePublic(m.role).nom}) : ${echapper(m.texte)}</li>`).join('') || '<li>Personne n\'est mort.</li>'}</ol>
      <div class="ligne" style="justify-content:center;margin-top:14px"><a class="btn principal" href="/jeux#soiree">Rejouer</a><a class="btn" href="/historique">Historique</a></div>
    </div>`;
  }

  function journal(ctx) {
    const j = ctx.vue.journal || [];
    return `<details class="lg-journal"><summary>📜 Journal de la partie</summary><div>${j.slice().reverse().map((x) => `<div class="lg-journal-ligne ${x.type}"><span class="muet petit">${echapper(x.quand)}</span> ${echapper(x.texte)}</div>`).join('')}</div></details>`;
  }

  // ------------------------------------------------------------------ rendu principal

  function scene(zone, ctx) {
    ctxCourant = ctx;
    const v = ctx.vue;
    if (!v) { zone.innerHTML = '<div class="vide">Chargement…</div>'; return; }
    const nuit = enJeu(ctx) && NUIT.includes(v.phase);
    document.body.classList.toggle('jeu-nuit', nuit);
    document.body.classList.toggle('jeu-jour', enJeu(ctx) && !nuit);
    sonsEtAlertes(ctx);
    majChat(ctx);
    brancher(zone);

    const p = ctx.prive;
    let principal = '';
    if (fini(ctx)) principal = ecranFin(ctx);
    else if (v.phase === 'distribution') principal = p ? carteRole(ctx, true) : '<div class="lg-dort">🃏 Les cartes sont distribuées…</div>';
    else if (p?.action) principal = panneauAction(ctx);
    else if (v.phase === 'annonce') principal = annonces(ctx);
    else if (v.vote) principal = voteSpectateur(ctx);
    else if (v.phase === 'debat') principal = `<div class="lg-debat">🗣️ <b>Débat</b> : discutez dans le chat <b>🏘 Village</b> pour démasquer les loups.${p?.vivant ? '' : '<br><span class="muet petit">Tu ne peux plus parler aux vivants : tu suis le débat.</span>'}<div><button class="btn" data-faire="ouvrir-chat">💬 Ouvrir le chat du village</button></div></div>`;
    else if (v.phase === 'chasseur') principal = `<div class="lg-dort">🏹 ${echapper(nom(ctx, v.chasseur))} choisit sa cible…</div>`;
    else if (nuit) principal = `<div class="lg-dort">${p && p.vivant ? '😴 Le village dort… Ferme les yeux.' : '🌙 La nuit est tombée sur le village…'}</div>`;

    const statut = !p ? '<div class="bandeau spectateur">👀 Tu regardes cette partie en spectateur. Tu peux discuter dans le 🪦 Cimetière.</div>'
      : !p.vivant && !fini(ctx) ? `<div class="bandeau elimine">💀 Tu es mort${p.action?.type === 'chasseur' ? ' — mais tu peux encore tirer !' : '. Tu restes en spectateur et peux parler dans le 🪦 Cimetière.'}</div>` : '';

    const html = `<div class="lg ${nuit ? 'nuit' : fini(ctx) ? 'fin' : 'jour'}">
      ${statut}
      ${fini(ctx) ? '' : `<div class="lg-entete"><div class="lg-narration">${echapper(v.narration || '')}</div>${p?.action ? '' : chrono(ctx)}</div>`}
      ${p && !fini(ctx) && v.phase !== 'distribution' ? `<div class="ligne" style="justify-content:flex-end;margin-bottom:6px"><button class="btn petit" data-faire="carte">🃏 Mon rôle</button></div>
        ${carteOuverte ? carteRole(ctx) : ''}` : ''}
      <div class="lg-principal">${principal}</div>
      ${journal(ctx)}
    </div>`;
    if (html !== dernierHtml) {
      const ouvert = zone.querySelector('.lg-journal')?.open;
      const votesOuverts = zone.querySelector('.lg-votes-finaux')?.open;
      zone.innerHTML = html;
      if (ouvert) zone.querySelector('.lg-journal').open = true;
      if (votesOuverts && zone.querySelector('.lg-votes-finaux')) zone.querySelector('.lg-votes-finaux').open = true;
      dernierHtml = html;
    }
    majChrono();
    if (!minuteur) minuteur = setInterval(majChrono, 250);
    if (defilerVersAction) {
      defilerVersAction = false;
      const cible = zone.querySelector('.lg-action');
      if (cible) {
        ctx.chat?.then((c) => (c?.estOuvert() ? c.fermer() : null)).catch(() => {});
        const haut = document.querySelector('.barre')?.offsetHeight || 0;
        window.scrollTo({ top: Math.max(0, window.scrollY + cible.getBoundingClientRect().top - haut - 8), behavior: 'smooth' });
      }
    }
  }

  function majChrono() {
    if (!ctxCourant) return;
    document.querySelectorAll('.lg-chrono[data-fin]').forEach((el) => {
      const s = Math.max(0, Math.ceil((Number(el.dataset.fin) - ctxCourant.maintenant()) / 1000));
      el.textContent = `⏱ ${s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`}`;
      el.classList.toggle('urgent', s <= 10);
    });
  }

  /** Clics dans la scène (branchés une seule fois : la scène est redessinée). */
  function brancher(zone) {
    if (zone.dataset.lg) return;
    zone.dataset.lg = '1';
    zone.addEventListener('click', async (e) => {
      const ctx = ctxCourant;
      if (!ctx) return;
      const cible = e.target.closest('[data-cible]');
      const faire = e.target.closest('[data-faire]')?.dataset.faire;
      const a = ctx.prive?.action;
      if (cible && a) {
        const id = cible.dataset.cible;
        if (a.type === 'loups') { await ctx.agir({ cible: id }); return; }
        if (a.type === 'vote') { await ctx.agir({ cible: a.choix === id ? null : id }); return; }
        if (a.type === 'cupidon') {
          selection.ids = selection.ids.includes(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id].slice(-2);
        } else selection.ids = selection.ids[0] === id ? [] : [id];
        dernierHtml = ''; scene(zone, ctx);
        return;
      }
      if (!faire) return;
      if (faire === 'carte') { carteOuverte = !carteOuverte; dernierHtml = ''; scene(zone, ctx); return; }
      if (faire === 'ouvrir-chat') { (await ctx.chat)?.afficher(`salle:${ctx.code}`); (await ctx.chat)?.ouvrir(); return; }
      if (faire === 'poison') { selection.poison = !selection.poison; selection.ids = []; dernierHtml = ''; scene(zone, ctx); return; }
      const bouton = e.target.closest('button');
      if (bouton) bouton.disabled = true;
      let rep = null;
      if (faire === 'cupidon') rep = await ctx.agir({ cibles: selection.ids });
      else if (['salvateur', 'voyante', 'chasseur'].includes(faire)) rep = await ctx.agir({ cible: selection.ids[0] });
      else if (faire === 'vie') rep = await ctx.agir({ potion: 'vie' });
      else if (faire === 'mort') { if (confirm(`Empoisonner ${nom(ctx, selection.ids[0])} ? La potion ne servira qu'une fois.`)) rep = await ctx.agir({ potion: 'mort', cible: selection.ids[0] }); }
      else if (faire === 'terminer') rep = await ctx.agir({ terminer: true });
      if (!rep?.ok && bouton) bouton.disabled = false;
    });
  }

  // ------------------------------------------------------------------ sons, notifications, chat

  function sonsEtAlertes(ctx) {
    const v = ctx.vue;
    const a = ctx.prive?.action;
    const cleAction = a ? `${a.type}:${v.numero}:${v.phase}` : null;
    const nbMorts = v.joueurs.filter((j) => !j.vivant).length;
    if (precedent.phase !== null) {
      const debutNuit = v.phase === 'nuit' && precedent.phase !== 'nuit';
      const debutJour = !NUIT.includes(v.phase) && NUIT.includes(precedent.phase) && v.phase !== 'fin';
      if (debutNuit) LW.son.nuit();
      else if (debutJour) LW.son.jour();
      if (nbMorts > precedent.morts) setTimeout(() => LW.son.mort(), debutJour ? 900 : 0);
      if (cleAction && cleAction !== precedent.cleAction) {
        defilerVersAction = true;
        setTimeout(() => LW.son.tonTour(), 400);
        LW.toast(`👉 C'est à toi d'agir : ${(TITRES_ACTION[a.type] || [''])[0]}`, 'ok');
      }
    }
    precedent = { phase: v.phase, etape: v.etape, numero: v.numero, cleAction, morts: nbMorts };
  }

  /** Salons du chat selon mon rôle : Village (tous), Loups (loups vivants), Cimetière (morts et spectateurs). */
  async function majChat(ctx) {
    const p = ctx.prive;
    const v = ctx.vue;
    const termine = fini(ctx);
    const village = `salle:${ctx.code}`;
    const salons = [{ canal: village, titre: '🏘 Village' }];
    if (termine || (p?.vivant && p.role.id === 'LOUP')) salons.push({ canal: `jeu:${ctx.code}:loups`, titre: '🐺 Loups' });
    if (termine || !p || !p.vivant) salons.push({ canal: `jeu:${ctx.code}:morts`, titre: '🪦 Cimetière' });
    const nuit = NUIT.includes(v.phase);
    const blocage = termine ? null : !p ? 'Spectateur : tu lis le village, mais tu écris dans le 🪦 Cimetière.'
      : !p.vivant ? 'Les morts ne parlent plus aux vivants : écris dans le 🪦 Cimetière.'
        : nuit ? '🌙 Le village dort : le chat est fermé la nuit.' : null;
    const cle = JSON.stringify([salons, blocage]);
    if (cle === derniersSalons) return;
    derniersSalons = cle;
    const chat = await ctx.chat;
    if (!chat?.definirSalons) return;
    await chat.definirSalons(salons);
    chat.bloquer(village, blocage);
  }

  /** Liste des joueurs de la salle (à droite) : vivants / morts, absents, rôle révélé, ma meute. */
  function listeJoueurs(ctx) {
    const v = ctx.vue;
    if (!v) return '';
    const moiId = String(ctx.moi.id);
    const loups = new Set((ctx.prive?.loups || []).map((l) => l.id));
    const partenaire = ctx.prive?.partenaire?.id;
    const tries = [...v.joueurs].sort((a, b) => (a.id === moiId ? -1 : b.id === moiId ? 1 : (b.vivant - a.vivant) || a.pseudo.localeCompare(b.pseudo, 'fr')));
    return tries.map((j) => {
      const r = rolePublic(j.role);
      const marques = [
        j.id !== moiId && loups.has(j.id) ? '<span title="Loup de ta meute">🐺</span>' : '',
        j.id === partenaire ? '<span title="Ton amoureux">💘</span>' : '',
      ].join('');
      const absent = j.connecte === false && enJeu(ctx);
      const exclure = ctx.meneur && absent && j.vivant && enJeu(ctx)
        ? `<button class="btn-exclure" title="Exclure ce joueur absent" data-exclure="${j.id}" data-pseudo="${echapper(j.pseudo)}">✕</button>` : '';
      return `<div class="joueur-ligne ${j.vivant ? '' : 'elimine'} ${j.id === moiId ? 'moi' : ''}">
        <span class="point ${absent ? 'absent' : ''}" title="${absent ? 'Absent (déconnecté)' : 'Connecté'}"></span>
        <span>${echapper(j.pseudo)} ${marques}</span>
        <span class="val">${j.vivant ? (absent ? '<span class="muet petit">absent</span>' : '') : `<span class="petit">${r ? `${r.icone} ` : ''}✝ <span class="muet">${echapper(j.mort?.quand || '')}</span></span>`}${exclure}</span></div>`;
    }).join('');
  }

  LW.miniJeux['loup-garou'] = { scene, listeJoueurs, libellePhase };
})();
