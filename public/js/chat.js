/**
 * Widget de discussion réutilisable :
 *   LW.chat.monter(conteneur, 'general')        sur l'accueil
 *   LW.chat.monter(conteneur, 'salle:K7Q2PX')   dans une salle de jeu
 * Le panneau peut être replié ; un compteur indique les messages non lus.
 */
(function () {
  const { echapper, h } = LW;

  const COULEUR_RANG = { R5: '#ffc35a', R4: '#f5a524', R3: '#8cc2ff', R2: '#9aa5b4', R1: '#9aa5b4' };
  const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

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
            <form class="chat-form">
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

      function ligne(m) {
        const lui = m.auteur.id === String(moi.id);
        const mention = !lui && m.texte.toLowerCase().includes(moi.pseudo.toLowerCase());
        const role = m.auteur.role === 'SUPER_ADMIN' || m.auteur.role === 'ADMIN' ? '<span class="chat-role">admin</span>' : '';
        const actions = [
          lui || peutModerer ? `<button data-suppr="${m.id}" title="Supprimer">✕</button>` : '',
          estAdmin && !lui && m.auteur.role !== 'SUPER_ADMIN' ? `<button data-muet="${m.auteur.id}" data-pseudo="${echapper(m.auteur.pseudo)}" title="Rendre muet">🔇</button>` : '',
        ].join('');
        return `<div class="chat-msg ${lui ? 'moi' : ''} ${mention ? 'mention' : ''}" data-id="${m.id}">
          <div class="chat-meta"><b style="color:${COULEUR_RANG[m.auteur.rang] || '#9aa5b4'}">${echapper(m.auteur.pseudo)}</b>
            <span class="chat-rang">${echapper(m.auteur.rang)}</span>${role}<span class="chat-heure">${heure(m.date)}</span>
            ${actions ? `<span class="chat-actions">${actions}</span>` : ''}</div>
          <div class="chat-texte">${echapper(m.texte)}</div></div>`;
      }

      function afficherTout(messages) {
        liste.innerHTML = messages.length ? messages.map(ligne).join('') : '<div class="vide petit chat-vide">Aucun message. Lance la conversation !</div>';
        liste.scrollTop = liste.scrollHeight;
      }

      function ajouter(m) {
        liste.querySelector('.chat-vide')?.remove();
        const enBas = liste.scrollHeight - liste.scrollTop - liste.clientHeight < 60;
        liste.insertAdjacentHTML('beforeend', ligne(m));
        while (liste.children.length > 100) liste.firstElementChild.remove();
        if (enBas || m.auteur.id === String(moi.id)) liste.scrollTop = liste.scrollHeight;
        if (estReplie && m.auteur.id !== String(moi.id)) { nonLus++; majBadge(); }
      }

      function majMuet(ms) {
        muetJusqua = ms > 0 ? Date.now() + ms : 0;
        const actif = muetJusqua > Date.now();
        zoneMuet.classList.toggle('cache', !actif);
        input.disabled = actif;
        form.querySelector('button').disabled = actif;
        if (actif) {
          zoneMuet.textContent = `🔇 Un admin t'a rendu muet (encore ${Math.ceil((muetJusqua - Date.now()) / 60000)} min).`;
          setTimeout(() => majMuet(muetJusqua - Date.now()), Math.min(60000, muetJusqua - Date.now() + 500));
        }
      }

      // modération (délégation d'événements)
      liste.addEventListener('click', async (e) => {
        const suppr = e.target.closest('[data-suppr]');
        const muet = e.target.closest('[data-muet]');
        if (suppr) {
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
        const rep = await LW.emettre('chat:envoyer', { canal, texte });
        if (!rep.ok) { LW.toast(rep.erreur, 'erreur'); if (!input.value) input.value = texte; }
        input.focus();
      };

      const surMessage = (m) => { if (m.canal === canal) ajouter(m); };
      const surSuppression = ({ canal: c, id }) => { if (c === canal) liste.querySelector(`[data-id="${id}"]`)?.remove(); };
      const surMuet = ({ muetMs }) => majMuet(muetMs);
      socket.on('chat:message', surMessage);
      socket.on('chat:supprime', surSuppression);
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
          socket.off('chat:muet', surMuet);
          socket.off('connect', rejoindre);
          LW.emettre('chat:quitter', { canal });
          panneau.remove();
        },
      };
    },
  };
})();
