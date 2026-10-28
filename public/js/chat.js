/**
 * Widget de discussion réutilisable :
 *   LW.chat.monter(conteneur, 'general')        sur l'accueil
 *   LW.chat.monter(conteneur, 'salle:K7Q2PX')   dans une salle de jeu
 * Le panneau peut être replié ; un compteur indique les messages non lus.
 * Sur chaque message : ↩ répondre, ❤ / 🎉 réagir (survol sur ordinateur, appui sur le message sur mobile).
 */
(function () {
  const { echapper, h } = LW;

  const COULEUR_RANG = { R5: '#ffc35a', R4: '#f5a524', R3: '#8cc2ff', R2: '#9aa5b4', R1: '#9aa5b4' };
  const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  /* ---------- emojis Last War ----------
   * Un emoji s'écrit « :lw12: » dans le texte du message (6 caractères, rien à changer côté serveur)
   * et s'affiche avec l'image /emojis/lw12.png. */
  const NB_EMOJIS = 79;
  const codeEmoji = (n) => `:lw${String(n).padStart(2, '0')}:`;
  const imgEmoji = (n, cls = 'emoji') => `<img class="${cls}" src="/emojis/lw${String(n).padStart(2, '0')}.png" alt="${codeEmoji(n)}" draggable="false" loading="lazy">`;
  const RE_EMOJI = /:lw(\d{2}):/g;
  const estEmoji = (n) => n >= 1 && n <= NB_EMOJIS;
  /** Texte déjà échappé → HTML avec les images. Un message fait uniquement de 1 à 3 emojis les affiche en grand. */
  function rendreTexte(texte) {
    const html = echapper(texte).replace(RE_EMOJI, (tout, n) => (estEmoji(Number(n)) ? imgEmoji(Number(n)) : tout));
    const seul = texte.replace(RE_EMOJI, (tout, n) => (estEmoji(Number(n)) ? '' : tout)).trim() === '';
    const nb = (texte.match(RE_EMOJI) || []).length;
    return { html, grand: seul && nb > 0 && nb <= 3 };
  }
  const CLE_RECENTS = 'lw-emojis-recents';
  /** Récents : 7 au maximum (une ligne), le plus récent en premier ; un nouveau fait sortir le plus ancien. */
  const MAX_RECENTS = 7;
  const lireRecents = () => { try { return (JSON.parse(localStorage.getItem(CLE_RECENTS)) || []).filter(estEmoji).slice(0, MAX_RECENTS); } catch { return []; } };
  /** Réactions possibles (mêmes numéros que côté serveur) : ❤ cœur, 🎉 confettis. */
  const REACTIONS = [{ n: 62, nom: 'J\'adore' }, { n: 74, nom: 'Bravo' }];
  const noterRecent = (n) => { try { localStorage.setItem(CLE_RECENTS, JSON.stringify([n, ...lireRecents().filter((x) => x !== n)].slice(0, MAX_RECENTS))); } catch { /* ignoré */ } };

  LW.chat = {
    /**
     * @param {HTMLElement} conteneur
     * @param {string} canal 'general' ou 'salle:CODE'
     * @param {{ titre?: string, replie?: boolean }} options
     */
    async monter(conteneur, canal, { titre = '💬 Discussion', replie = false } = {}) {
      const socket = await LW.socket();
      const moi = LW.moi;
      const cleReplie = `lw-chat-replie-${canal.startsWith('salle:') ? 'salle' : canal}`;
      let estReplie = replie;
      try { const v = localStorage.getItem(cleReplie); if (v !== null) estReplie = v === '1'; } catch { /* stockage indisponible */ }
      let nonLus = 0;
      let muetJusqua = 0;

      conteneur.innerHTML = '';
      const panneau = h(`
        <section class="panneau chat ${estReplie ? 'replie' : ''}">
          <button class="chat-entete" type="button">
            <span>${echapper(titre)}</span>
            <span class="badge or cache chat-non-lus">0</span>
            <span class="chat-fleche">▾</span>
          </button>
          <div class="chat-corps">
            <div class="chat-messages" aria-live="polite"><div class="vide petit">Chargement…</div></div>
            <div class="chat-muet cache"></div>
            <div class="chat-emojis cache" role="dialog" aria-label="Emojis">
              <div class="chat-emojis-recents cache"><div class="chat-emojis-titre">Récents</div><div class="chat-emojis-grille"></div></div>
              <div class="chat-emojis-titre">Last War</div>
              <div class="chat-emojis-grille tous"></div>
            </div>
            <div class="chat-reponse cache">
              <div class="chat-reponse-txt"></div>
              <button type="button" class="chat-reponse-annuler" title="Annuler la réponse" aria-label="Annuler la réponse">✕</button>
            </div>
            <div class="chat-apercu cache" aria-hidden="true"></div>
            <form class="chat-form">
              <button type="button" class="chat-btn-emoji" title="Emojis" aria-label="Emojis" aria-expanded="false">${imgEmoji(1, 'emoji-btn')}</button>
              <input maxlength="200" placeholder="Écris un message…" autocomplete="off" enterkeyhint="send">
              <button class="btn principal petit" title="Envoyer">➤</button>
            </form>
          </div>
        </section>`);
      conteneur.appendChild(panneau);
      const liste = panneau.querySelector('.chat-messages');
      const form = panneau.querySelector('.chat-form');
      const input = form.querySelector('input');
      const badge = panneau.querySelector('.chat-non-lus');
      const zoneMuet = panneau.querySelector('.chat-muet');

      // ---------- sélecteur d'emojis ----------
      const boiteEmojis = panneau.querySelector('.chat-emojis');
      const btnEmoji = form.querySelector('.chat-btn-emoji');
      const apercu = panneau.querySelector('.chat-apercu');
      // aperçu du message avec les images quand il contient des emojis (le champ, lui, montre les codes :lwNN:)
      const majApercu = () => {
        const v = input.value;
        const avec = RE_EMOJI.test(v); RE_EMOJI.lastIndex = 0;
        apercu.classList.toggle('cache', !avec);
        if (avec) apercu.innerHTML = rendreTexte(v).html;
      };
      input.addEventListener('input', majApercu);
      const blocRecents = boiteEmojis.querySelector('.chat-emojis-recents');
      const case_ = (n) => `<button type="button" data-emoji="${n}" title="${codeEmoji(n)}">${imgEmoji(n)}</button>`;
      boiteEmojis.querySelector('.tous').innerHTML = Array.from({ length: NB_EMOJIS }, (_, i) => case_(i + 1)).join('');
      function ouvrirEmojis(ouvrir) {
        if (ouvrir) {
          const r = lireRecents();
          blocRecents.classList.toggle('cache', !r.length);
          blocRecents.querySelector('.chat-emojis-grille').innerHTML = r.map(case_).join('');
        }
        boiteEmojis.classList.toggle('cache', !ouvrir);
        btnEmoji.classList.toggle('actif', ouvrir);
        btnEmoji.setAttribute('aria-expanded', String(ouvrir));
      }
      btnEmoji.onclick = () => ouvrirEmojis(boiteEmojis.classList.contains('cache'));
      boiteEmojis.addEventListener('click', (e) => {
        const b = e.target.closest('[data-emoji]');
        if (!b || input.disabled) return;
        const code = codeEmoji(Number(b.dataset.emoji));
        if (input.value.length + code.length > 200) { LW.toast('Message trop long.', 'erreur'); return; }
        // insertion à la position du curseur
        const debut = input.selectionStart ?? input.value.length;
        const fin = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, debut) + code + input.value.slice(fin);
        const pos = debut + code.length;
        noterRecent(Number(b.dataset.emoji));
        majApercu();
        // sur mobile, on évite de faire surgir le clavier à chaque emoji
        if (!matchMedia('(hover: none)').matches) { input.focus(); input.setSelectionRange(pos, pos); }
      });
      // (on ignore le formulaire : fermer la boîte au pointerdown déplacerait le bouton « Envoyer » sous le doigt)
      const fermerSiDehors = (e) => { if (!boiteEmojis.classList.contains('cache') && !boiteEmojis.contains(e.target) && !form.contains(e.target)) ouvrirEmojis(false); };
      const fermerEchap = (e) => {
        if (e.key !== 'Escape') return;
        if (!boiteEmojis.classList.contains('cache')) ouvrirEmojis(false);
        else if (reponseA && panneau.contains(document.activeElement)) choisirReponse(null);
      };
      document.addEventListener('pointerdown', fermerSiDehors);
      document.addEventListener('keydown', fermerEchap);

      const majBadge = () => { badge.textContent = nonLus; badge.classList.toggle('cache', !estReplie || !nonLus); };
      panneau.querySelector('.chat-entete').onclick = () => {
        estReplie = !estReplie;
        panneau.classList.toggle('replie', estReplie);
        try { localStorage.setItem(cleReplie, estReplie ? '1' : '0'); } catch { /* ignoré */ }
        if (!estReplie) { nonLus = 0; liste.scrollTop = liste.scrollHeight; }
        majBadge();
      };

      const peutModerer = LW.peutOrganiser(moi);
      const estAdmin = LW.estAdmin(moi);
      const parId = new Map(); // id -> message (pour répondre)

      // ---------- répondre ----------
      const zoneReponse = panneau.querySelector('.chat-reponse');
      let reponseA = null;
      function choisirReponse(m) {
        reponseA = m;
        zoneReponse.classList.toggle('cache', !m);
        if (m) {
          zoneReponse.querySelector('.chat-reponse-txt').innerHTML = `<span class="muet">Réponse à</span> <b>${echapper(m.auteur.pseudo)}</b> <span class="chat-reponse-extrait">${rendreTexte(m.texte).html}</span>`;
          input.focus();
        }
      }
      zoneReponse.querySelector('.chat-reponse-annuler').onclick = () => choisirReponse(null);

      // ---------- réactions ----------
      function puces(id, reactions = {}) {
        return REACTIONS.map(({ n }) => {
          const qui = reactions[n] || [];
          if (!qui.length) return '';
          const moiAussi = qui.some((p) => p.id === String(moi.id));
          const noms = qui.map((p) => p.pseudo).join(', ');
          return `<button type="button" class="chat-puce ${moiAussi ? 'moi' : ''}" data-reagir="${id}" data-emoji="${n}" title="${echapper(noms)}">${imgEmoji(n)}<span>${qui.length}</span></button>`;
        }).join('');
      }
      function citation(r) {
        if (!r) return '';
        return `<button type="button" class="chat-citation" data-aller="${r.id}" data-ref="${r.id}" title="Voir le message">
          <b>↩ ${echapper(r.auteur.pseudo)}</b> <span>${r.supprime ? '<i>message supprimé</i>' : rendreTexte(r.texte).html}</span></button>`;
      }

      function ligne(m) {
        const lui = m.auteur.id === String(moi.id);
        const mention = !lui && (m.texte.toLowerCase().includes(moi.pseudo.toLowerCase()) || m.reponse?.auteur.id === String(moi.id));
        parId.set(m.id, m);
        const role = m.auteur.role === 'SUPER_ADMIN' || m.auteur.role === 'ADMIN' ? '<span class="chat-role">admin</span>' : '';
        const actions = [
          `<button data-repondre="${m.id}" title="Répondre" aria-label="Répondre">↩</button>`,
          ...REACTIONS.map(({ n, nom }) => `<button class="chat-reac" data-reagir="${m.id}" data-emoji="${n}" title="${nom}" aria-label="${nom}">${imgEmoji(n)}</button>`),
          lui || peutModerer ? `<button data-suppr="${m.id}" title="Supprimer">✕</button>` : '',
          estAdmin && !lui && m.auteur.role !== 'SUPER_ADMIN' ? `<button data-muet="${m.auteur.id}" data-pseudo="${echapper(m.auteur.pseudo)}" title="Rendre muet">🔇</button>` : '',
        ].join('');
        return `<div class="chat-msg ${lui ? 'moi' : ''} ${mention ? 'mention' : ''}" data-id="${m.id}">
          <div class="chat-meta"><b style="color:${COULEUR_RANG[m.auteur.rang] || '#9aa5b4'}">${echapper(m.auteur.pseudo)}</b>
            ${LW.rangVisible(m.auteur.rang) ? `<span class="chat-rang">${echapper(m.auteur.rang)}</span>` : ''}${role}<span class="chat-heure">${heure(m.date)}</span>
            ${actions ? `<span class="chat-actions">${actions}</span>` : ''}</div>
          ${citation(m.reponse)}
          ${(({ html, grand }) => `<div class="chat-texte${grand ? ' grand' : ''}">${html}</div>`)(rendreTexte(m.texte))}
          <div class="chat-reactions">${puces(m.id, m.reactions)}</div></div>`;
      }

      function afficherTout(messages) {
        parId.clear();
        liste.innerHTML = messages.length ? messages.map(ligne).join('') : '<div class="vide petit chat-vide">Aucun message. Lance la conversation !</div>';
        liste.scrollTop = liste.scrollHeight;
      }

      function ajouter(m) {
        liste.querySelector('.chat-vide')?.remove();
        const enBas = liste.scrollHeight - liste.scrollTop - liste.clientHeight < 60;
        liste.insertAdjacentHTML('beforeend', ligne(m));
        while (liste.children.length > 100) { parId.delete(liste.firstElementChild.dataset.id); liste.firstElementChild.remove(); }
        if (enBas || m.auteur.id === String(moi.id)) liste.scrollTop = liste.scrollHeight;
        if (estReplie && m.auteur.id !== String(moi.id)) { nonLus++; majBadge(); }
      }

      function majMuet(ms) {
        muetJusqua = ms > 0 ? Date.now() + ms : 0;
        const actif = muetJusqua > Date.now();
        zoneMuet.classList.toggle('cache', !actif);
        input.disabled = actif;
        form.querySelectorAll('button').forEach((b) => { b.disabled = actif; });
        if (actif) ouvrirEmojis(false);
        if (actif) {
          zoneMuet.textContent = `🔇 Un admin t'a rendu muet (encore ${Math.ceil((muetJusqua - Date.now()) / 60000)} min).`;
          setTimeout(() => majMuet(muetJusqua - Date.now()), Math.min(60000, muetJusqua - Date.now() + 500));
        }
      }

      // actions sur les messages (délégation d'événements)
      liste.addEventListener('click', async (e) => {
        const suppr = e.target.closest('[data-suppr]');
        const muet = e.target.closest('[data-muet]');
        const repondre = e.target.closest('[data-repondre]');
        const reagir = e.target.closest('[data-reagir]');
        const aller = e.target.closest('[data-aller]');
        const msg = e.target.closest('.chat-msg');
        // sur mobile (pas de survol) : un appui sur le message affiche ses boutons
        if (!e.target.closest('button') && msg && matchMedia('(hover: none)').matches) {
          const etait = msg.classList.contains('ouvert');
          liste.querySelectorAll('.chat-msg.ouvert').forEach((x) => x.classList.remove('ouvert'));
          msg.classList.toggle('ouvert', !etait);
          return;
        }
        if (repondre) {
          const m = parId.get(repondre.dataset.repondre);
          if (m) choisirReponse(m);
          msg?.classList.remove('ouvert');
        } else if (reagir) {
          if (input.disabled) { LW.toast('Tu es muet pour le moment.', 'erreur'); return; }
          const rep = await LW.emettre('chat:reagir', { canal, id: reagir.dataset.reagir, emoji: Number(reagir.dataset.emoji) });
          if (!rep.ok) LW.toast(rep.erreur, 'erreur');
          msg?.classList.remove('ouvert');
        } else if (aller) {
          const cible = liste.querySelector(`.chat-msg[data-id="${aller.dataset.aller}"]`);
          if (!cible) { LW.toast('Ce message n\'est plus affiché.', 'erreur'); return; }
          cible.scrollIntoView({ block: 'center', behavior: 'smooth' });
          cible.classList.remove('flash'); void cible.offsetWidth; cible.classList.add('flash');
        } else if (suppr) {
          if (!confirm('Supprimer ce message ?')) return;
          const rep = await LW.emettre('chat:supprimer', { canal, id: suppr.dataset.suppr });
          if (!rep.ok) LW.toast(rep.erreur, 'erreur');
        } else if (muet) {
          const min = prompt(`Rendre « ${muet.dataset.pseudo} » muet combien de minutes ? (0 = lever la sanction)`, '10');
          if (min === null) return;
          const rep = await LW.emettre('chat:muet', { joueurId: muet.dataset.muet, minutes: Number(min) });
          LW.toast(rep.ok ? (rep.minutes ? `${rep.pseudo} est muet pour ${rep.minutes} min.` : `${rep.pseudo} peut de nouveau écrire.`) : rep.erreur, rep.ok ? 'ok' : 'erreur');
        }
      });

      form.onsubmit = async (e) => {
        e.preventDefault();
        const texte = input.value.trim();
        if (!texte) return;
        input.value = '';
        majApercu();
        ouvrirEmojis(false);
        const enReponse = reponseA;
        choisirReponse(null);
        const rep = await LW.emettre('chat:envoyer', { canal, texte, ...(enReponse ? { reponseA: enReponse.id } : {}) });
        if (!rep.ok) {
          LW.toast(rep.erreur, 'erreur');
          if (!input.value) { input.value = texte; majApercu(); }
          if (enReponse && parId.has(enReponse.id) && !reponseA) choisirReponse(enReponse);
        }
        input.focus();
      };

      const surMessage = (m) => { if (m.canal === canal) ajouter(m); };
      const surSuppression = ({ canal: c, id }) => {
        if (c !== canal) return;
        liste.querySelector(`.chat-msg[data-id="${id}"]`)?.remove();
        parId.delete(id);
        if (reponseA?.id === id) choisirReponse(null);
        liste.querySelectorAll(`.chat-citation[data-ref="${id}"] span`).forEach((x) => { x.innerHTML = '<i>message supprimé</i>'; });
      };
      const surReaction = ({ canal: c, id, reactions }) => {
        if (c !== canal) return;
        const m = parId.get(id);
        if (m) m.reactions = reactions;
        const zone = liste.querySelector(`.chat-msg[data-id="${id}"] .chat-reactions`);
        if (!zone) return;
        const enBas = liste.scrollHeight - liste.scrollTop - liste.clientHeight < 60;
        zone.innerHTML = puces(id, reactions);
        if (enBas) liste.scrollTop = liste.scrollHeight; // les puces du dernier message restent visibles
      };
      const surMuet = ({ muetMs }) => majMuet(muetMs);
      socket.on('chat:message', surMessage);
      socket.on('chat:supprime', surSuppression);
      socket.on('chat:reaction', surReaction);
      socket.on('chat:muet', surMuet);

      async function rejoindre() {
        const rep = await LW.emettre('chat:rejoindre', { canal });
        if (!rep.ok) { liste.innerHTML = `<div class="vide petit">${echapper(rep.erreur)}</div>`; return; }
        afficherTout(rep.messages);
        majMuet(rep.muetMs);
      }
      socket.on('connect', rejoindre); // reconnexion : on recharge l'historique
      if (socket.connected) await rejoindre();
      majBadge();

      return {
        detruire() {
          socket.off('chat:message', surMessage);
          socket.off('chat:supprime', surSuppression);
          socket.off('chat:reaction', surReaction);
          socket.off('chat:muet', surMuet);
          socket.off('connect', rejoindre);
          document.removeEventListener('pointerdown', fermerSiDehors);
          document.removeEventListener('keydown', fermerEchap);
          LW.emettre('chat:quitter', { canal });
          panneau.remove();
        },
      };
    },
  };
})();
