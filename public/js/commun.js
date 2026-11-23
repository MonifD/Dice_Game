/**
 * Fonctions partagées par toutes les pages :
 * appels API, session, barre de navigation, notifications, connexion Socket.IO.
 */
(function () {
  const LW = (window.LW = window.LW || {});
  LW.miniJeux = LW.miniJeux || {}; // rempli par les scripts /minijeux/<id>/client.js

  // ---------------------------------------------------------- utilitaires
  LW.echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  LW.$ = (sel, racine = document) => racine.querySelector(sel);
  LW.$$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];
  LW.h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  LW.date = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  LW.attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  LW.toast = (message, type = '') => {
    let zone = document.getElementById('toasts');
    if (!zone) { zone = document.createElement('div'); zone.id = 'toasts'; document.body.appendChild(zone); }
    const t = LW.h(`<div class="toast ${type}">${LW.echapper(message)}</div>`);
    zone.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  };

  /** Date courte « 28/10 ». */
  LW.dateCourte = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

  // ---------------------------------------------------------- objet de la partie (Conducteur / VIP du train / Pour s'amuser)
  LW.objets = {
    CONDUCTEUR: { icone: '🚂', court: 'Conducteur', long: 'Conducteur du train', cls: 'conducteur' },
    VIP: { icone: '⭐', court: 'VIP', long: 'VIP du train', cls: 'vip' },
    AMUSEMENT: { icone: '🎉', court: 'Pour s\'amuser', long: 'Pour s\'amuser', cls: 'amusement' },
  };
  /** Objets qui désignent le gagnant pour un jour J. */
  LW.objetsDesignation = ['CONDUCTEUR', 'VIP'];
  /** « AAAA-MM-JJ » -> « 28/10 » (sans passer par Date : pas de décalage de fuseau). */
  LW.jour = (s) => { const [, m, d] = String(s || '').slice(0, 10).split('-'); return d && m ? `${d}/${m}` : ''; };
  /**
   * Jour de jeu en cours, « AAAA-MM-JJ » : un jour commence à 3h00 du matin, heure de Paris
   * (le 24/11 à 1h, on est encore le 23/11). Miroir de src/services/jour.js.
   */
  LW.aujourdhui = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
    if (Number(p.hour) < 3) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  /** Badge « 🚂 Conducteur le 28/10 » (vide si la partie n'a pas d'objet). */
  LW.badgeObjet = (objet, { long = false, date = null } = {}) => {
    const o = LW.objets[objet];
    return o ? `<span class="badge objet ${o.cls}">${o.icone} ${long ? o.long : o.court}${date ? ` le ${LW.jour(date)}` : ''}</span>` : '';
  };
  /**
   * Liste des joueurs en ligne (pastille verte), mise à jour en direct par le serveur (presence:maj).
   * « En ligne » = une page avec connexion temps réel ouverte (accueil ou salle).
   */
  LW.afficherConnectes = async (conteneur) => {
    const couleur = { R5: '#ffc35a', R4: '#f5a524', R3: '#8cc2ff' };
    const rendre = (joueurs = []) => {
      conteneur.innerHTML = `<h3 class="en-ligne-titre"><span class="pastille-verte"></span>En ligne <span class="badge vert">${joueurs.length}</span></h3>
        <div class="liste-en-ligne">${joueurs.map((j) => `<span class="connecte ${j.id === String(LW.moi?.id) ? 'moi' : ''}">
          <span class="pastille-verte"></span><b style="color:${couleur[j.rang] || 'var(--texte)'}">${LW.echapper(j.pseudo)}</b>${LW.rangVisible(j.rang) ? `<span class="chat-rang">${j.rang}</span>` : ''}${j.role === 'ADMIN' || j.role === 'SUPER_ADMIN' ? '<span class="chat-role">admin</span>' : ''}</span>`).join('')
          || '<span class="muet petit">Personne en ligne.</span>'}</div>`;
    };
    rendre();
    const socket = await LW.socket();
    socket.on('presence:maj', ({ joueurs }) => rendre(joueurs));
    const suivre = async () => { const r = await LW.emettre('presence:suivre'); if (r.ok) rendre(r.joueurs); };
    socket.on('connect', suivre); // reconnexion : on se réabonne
    if (socket.connected) await suivre();
  };

  /**
   * Bandeaux de l'accueil : Conducteur et VIP désignés pour le jour en cours (un jour commence à 3h00).
   * Une désignation pour un jour futur n'apparaît que ce jour-là. Personne : « Non désigné ».
   */
  LW.afficherDesignations = async (conteneur) => {
    try {
      const { designations } = await LW.api('/api/designations');
      const modifiable = LW.peutOrganiser(LW.moi);
      conteneur.innerHTML = `<div class="designations">${LW.objetsDesignation.map((cle) => {
        const o = LW.objets[cle];
        const d = designations[cle];
        // sur téléphone, seuls le logo, le nom court et le pseudo restent visibles (voir style.css)
        return `<div class="designation ${o.cls}">
          <div class="ic">${o.icone}</div>
          <div class="txt"><div class="titre"><span class="lib">${o.long}</span><span class="sep"> · </span><span class="quand">aujourd'hui</span><span class="quand seul">${o.court}</span></div>
            ${d ? `<div class="nom">${LW.echapper(d.joueur.pseudo)}</div><div class="muet petit gagne">${d.miniJeu ? `gagné au ${d.icone || '🎮'} ${LW.echapper(d.miniJeu)}` : 'désigné à la main'}</div>`
              : '<div class="nom muet">Non désigné</div>'}
          </div>
          ${modifiable ? `<a class="btn lien petit modifier-desig" href="/historique#designations" title="Modifier le ${o.court} d'une date">✎</a>` : ''}
        </div>`;
      }).join('')}</div>`;
    } catch { conteneur.innerHTML = ''; }
  };

  // ---------------------------------------------------------- mot de passe temporaire
  /**
   * Un R4 / R5 / admin a donné un mot de passe temporaire : le membre doit en choisir un nouveau
   * avant d'accéder au reste du site (le serveur refuse tout le reste avec le code « changer_mdp »).
   */
  let fenetreMdp = false;
  LW.exigerNouveauMotDePasse = () => {
    if (fenetreMdp) return;
    fenetreMdp = true;
    const f = LW.h(`<div class="voile"><form class="panneau fenetre" id="form-nouveau-mdp">
      <h2>🔑 Nouveau mot de passe</h2>
      <p class="muet">Ton mot de passe a été réinitialisé par un responsable. Choisis ton propre mot de passe pour continuer.</p>
      <div class="champ"><label for="nmdp-1">Nouveau mot de passe</label><input type="password" id="nmdp-1" minlength="6" maxlength="72" required autocomplete="new-password"></div>
      <div class="champ"><label for="nmdp-2">Confirme le mot de passe</label><input type="password" id="nmdp-2" minlength="6" maxlength="72" required autocomplete="new-password"></div>
      <div class="ligne"><button class="btn principal">Enregistrer</button><button type="button" class="btn lien" id="nmdp-sortir">Se déconnecter</button></div>
    </form></div>`);
    document.body.appendChild(f);
    LW.$('#nmdp-1').focus();
    LW.$('#nmdp-sortir').onclick = LW.deconnexion;
    LW.$('#form-nouveau-mdp').onsubmit = async (e) => {
      e.preventDefault();
      const nouveau = LW.$('#nmdp-1').value;
      if (nouveau !== LW.$('#nmdp-2').value) { LW.toast('Les deux mots de passe ne sont pas identiques.', 'erreur'); return; }
      try {
        await LW.api('/api/auth/mot-de-passe', { methode: 'POST', corps: { nouveau } });
        LW.toast('Mot de passe enregistré.', 'ok');
        setTimeout(() => location.reload(), 700);
      } catch (err) { LW.toast(err.message, 'erreur'); }
    };
  };

  // ---------------------------------------------------------- API
  LW.api = async (chemin, { methode = 'GET', corps } = {}) => {
    const rep = await fetch(chemin, {
      method: methode, credentials: 'include',
      headers: corps ? { 'Content-Type': 'application/json' } : {},
      body: corps ? JSON.stringify(corps) : undefined,
    });
    let donnees = {};
    try { donnees = await rep.json(); } catch { /* réponse vide */ }
    if (rep.status === 401 && !chemin.startsWith('/api/auth/')) { location.href = '/'; throw new Error('Connexion requise.'); }
    if (rep.status === 403 && donnees.code === 'changer_mdp') LW.exigerNouveauMotDePasse();
    if (!rep.ok) throw new Error(donnees.erreur || `Erreur ${rep.status}`);
    return donnees;
  };

  // ---------------------------------------------------------- droits (miroir de src/services/permissions.js, pour l'affichage seulement)
  // niveaux : super admin 4 > R5 3 > R4 admin 2 > admin 1 > joueur 0 (le R5 a les droits du super admin)
  // un R1 / R2 ne peut pas être admin
  LW.peutEtreAdmin = (rang) => rang !== 'R1' && rang !== 'R2';
  LW.niveau = (j) => (!j ? 0 : j.role === 'SUPER_ADMIN' ? 4 : j.rang === 'R5' ? 3 : j.role === 'ADMIN' && LW.peutEtreAdmin(j.rang) ? (j.rang === 'R4' ? 2 : 1) : 0);
  LW.estAdmin = (j) => LW.niveau(j) >= 1;
  LW.estSuperAdmin = (j) => j && j.role === 'SUPER_ADMIN';
  LW.aDroitsSuperAdmin = (j) => LW.niveau(j) >= 3;
  LW.peutChangerRoles = (j) => LW.niveau(j) >= 2;
  /** Seuls les rangs R4 et R5 sont affichés à côté des pseudos (R1–R3 : le nom seul). */
  LW.rangVisible = (rang) => rang === 'R4' || rang === 'R5';
  /** R4, R5 et admins : Conducteur / VIP, toutes les salles, désignations, comptes des membres. */
  LW.peutOrganiser = (j) => j && (LW.estAdmin(j) || j.rang === 'R4' || j.rang === 'R5');
  /** Mener une salle : son organisateur, ou un R4 / R5 / admin. */
  LW.peutMenerSalle = (j, etat) => !!j && (LW.peutOrganiser(j) || String(etat?.organisateur?.id) === String(j.id));
  /** Mot de passe temporaire / suppression : super admin > admin > R5 > R4 > membres (miroir de niveauComptes). */
  LW.niveauComptes = (j) => (!j ? 0 : j.role === 'SUPER_ADMIN' ? 4 : j.role === 'ADMIN' && LW.peutEtreAdmin(j.rang) ? 3 : j.rang === 'R5' ? 2 : j.rang === 'R4' ? 1 : 0);
  LW.libelleRole = (j) => (j.role === 'SUPER_ADMIN' ? 'Super admin' : j.role === 'ADMIN' ? 'Admin' : '');

  /** Charge le joueur connecté ; redirige vers la connexion si besoin. */
  LW.session = async ({ obligatoire = true } = {}) => {
    try {
      const { joueur, jeton } = await LW.api('/api/auth/moi');
      LW.moi = joueur;
      LW.jetonSocket = jeton;
      if (joueur.doitChangerMdp) LW.exigerNouveauMotDePasse();
      return joueur;
    } catch (e) {
      if (obligatoire) location.href = `/?retour=${encodeURIComponent(location.pathname + location.search)}`;
      return null;
    }
  };

  LW.deconnexion = async () => { await LW.api('/api/auth/deconnexion', { methode: 'POST' }).catch(() => {}); location.href = '/'; };

  /** Barre de navigation commune. */
  LW.barre = (pageActive) => {
    const j = LW.moi;
    // Accueil – Jeux – Historique – Administration (R4, R5 et admins) ; mêmes liens dans le menu burger
    const liens = [
      ['accueil', '/accueil', 'Accueil'],
      ['jeux', '/jeux', 'Jeux'],
      ['historique', '/historique', 'Historique'],
      ...(LW.peutOrganiser(j) ? [['admin', '/admin', 'Administration']] : []),
    ];
    const badges = `${LW.rangVisible(j.rang) ? `<span class="badge or">${LW.echapper(j.rang)}</span>` : ''}
          ${LW.libelleRole(j) ? `<span class="badge bleu">${LW.libelleRole(j)}</span>` : ''}`;
    const barre = LW.h(`
      <header class="barre">
        <a class="logo" href="/accueil"><img class="ecusson" src="/img/logo-96.jpg" alt="" width="38" height="38"><span>UPX <span class="muet petit">Arène</span></span></a>
        <nav class="nav">${liens.map(([id, href, txt]) => `<a href="${href}" class="${id === pageActive ? 'actif' : ''}">${txt}</a>`).join('')}</nav>
        <div class="profil">
          ${badges}
          <span class="pseudo">${LW.echapper(j.pseudo)}</span>
          <button class="btn lien petit" id="btn-deconnexion" title="Déconnexion">⏻</button>
        </div>
        <button class="burger" id="btn-burger" aria-label="Menu" aria-expanded="false" aria-controls="menu-mobile"><span></span><span></span><span></span></button>
        <div class="menu-mobile" id="menu-mobile" hidden>
          <div class="menu-profil"><span class="pseudo">${LW.echapper(j.pseudo)}</span><span class="ligne" style="gap:6px">${badges}</span></div>
          <nav>${liens.map(([id, href, txt]) => `<a href="${href}" class="${id === pageActive ? 'actif' : ''}">${txt}</a>`).join('')}</nav>
          <button class="btn danger" id="btn-deconnexion-mobile">⏻ Se déconnecter</button>
        </div>
      </header>`);
    document.body.prepend(barre);
    LW.$('#btn-deconnexion').onclick = LW.deconnexion;
    LW.$('#btn-deconnexion-mobile').onclick = LW.deconnexion;

    // menu burger (téléphone)
    const burger = LW.$('#btn-burger');
    const menu = LW.$('#menu-mobile');
    const ouvrirMenu = (ouvert) => {
      menu.hidden = !ouvert;
      burger.setAttribute('aria-expanded', String(ouvert));
      burger.classList.toggle('ouvert', ouvert);
    };
    burger.onclick = (e) => { e.stopPropagation(); ouvrirMenu(menu.hidden); };
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) ouvrirMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ouvrirMenu(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 720) ouvrirMenu(false); });
    LW.piedDePage();
  };

  /** Pied de page : propriété du site (UPX) et version déployée (utile pour savoir ce qui tourne en production). */
  LW.piedDePage = () => {
    if (document.getElementById('pied-version')) return;
    const texte = (version) => `UPX Arène · Copyright © ${new Date().getFullYear()} UPX${version ? ` · ${version}` : ''}`;
    const pied = LW.h('<footer id="pied-version" class="muet petit" style="text-align:center;padding:24px 16px;opacity:.6"></footer>');
    pied.textContent = texte('');
    document.body.appendChild(pied);
    chargerConfig().then((c) => { pied.textContent = texte(c.version); }).catch(() => {});
  };

  // ---------------------------------------------------------- Socket.IO
  let configPromesse = null;
  const chargerConfig = () => (configPromesse ||= fetch('/api/config').then((r) => r.json()));

  // une seule promesse par script : deux appels simultanés attendent le même chargement
  const scripts = new Map();
  const chargerScript = (src) => {
    if (!scripts.has(src)) {
      scripts.set(src, new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve;
        s.onerror = () => { scripts.delete(src); reject(new Error(`Impossible de charger ${src}`)); };
        document.head.appendChild(s);
      }));
    }
    return scripts.get(src);
  };
  LW.chargerScript = chargerScript;

  /**
   * Connexion temps réel. transports: ['websocket'] est obligatoire sur Vercel.
   * Le jeton est redemandé à chaque (re)connexion : un joueur qui revient après une coupure
   * retrouve sa place automatiquement.
   */
  let socketPromesse = null;
  LW.socket = () => (socketPromesse ||= creerSocket());
  const creerSocket = async () => {
    const cfg = await chargerConfig();
    const base = cfg.urlTempsReel || '';
    await chargerScript(`${base}${cfg.socketPath}/socket.io.js`);
    const socket = window.io(base || undefined, {
      path: cfg.socketPath,
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      auth: (cb) => {
        LW.api('/api/auth/moi').then((d) => cb({ token: d.jeton })).catch(() => cb({}));
      },
    });
    socket.on('connect_error', (e) => {
      if (e.message === 'non_authentifie') location.href = '/';
      if (e.message === 'changer_mdp') { socket.disconnect(); LW.exigerNouveauMotDePasse(); }
    });
    socket.on('disconnect', (raison) => {
      if (raison === 'io server disconnect') { LW.toast('Tu as été déconnecté par un admin.', 'erreur'); setTimeout(() => (location.href = '/'), 1500); }
    });
    LW._socket = socket;
    return socket;
  };

  // ---------------------------------------------------------- sons et alertes
  /**
   * Sons générés par le navigateur (aucun fichier). Les navigateurs n'autorisent le son
   * qu'après un premier clic sur la page : on « déverrouille » l'audio au premier geste.
   */
  let audio = null;
  const contexteAudio = () => {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    audio ||= new C();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, contexteAudio, { once: true, passive: true }));

  /** Joue une suite de notes : [[fréquence Hz, durée s], …]. */
  const jouerNotes = (notes, volume = 0.25) => {
    const ctx = contexteAudio();
    if (!ctx) return;
    let t = ctx.currentTime + 0.02;
    for (const [freq, duree] of notes) {
      if (freq) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duree);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + duree + 0.02);
      }
      t += duree;
    }
  };

  /** Fait clignoter le titre de l'onglet tant que la page n'est pas regardée. */
  let clignotement = null;
  const clignoterTitre = (message) => {
    if (!document.hidden || clignotement) return;
    const titre = document.title;
    let bascule = false;
    clignotement = setInterval(() => { document.title = (bascule = !bascule) ? message : titre; }, 900);
    document.addEventListener('visibilitychange', function stop() {
      if (document.hidden) return;
      clearInterval(clignotement); clignotement = null; document.title = titre;
      document.removeEventListener('visibilitychange', stop);
    });
  };

  LW.son = {
    /** Alerte « la partie va commencer » : trois bips, vibration, titre qui clignote. */
    alerte() {
      jouerNotes([[880, 0.15], [0, 0.08], [880, 0.15], [0, 0.08], [1320, 0.35]]);
      navigator.vibrate?.([200, 100, 200, 100, 400]);
      clignoterTitre('🔔 Prépare-toi !');
    },
    /** Loup-Garou : la nuit tombe (notes graves descendantes). */
    nuit() { jouerNotes([[392, 0.35], [330, 0.35], [262, 0.6]], 0.18); },
    /** Loup-Garou : le jour se lève (notes montantes). */
    jour() { jouerNotes([[523, 0.18], [659, 0.18], [784, 0.4]], 0.2); },
    /** Annonce d'une mort (glas). */
    mort() { jouerNotes([[196, 0.5], [0, 0.12], [185, 0.7]], 0.22); navigator.vibrate?.(250); },
    /** C'est à toi d'agir : deux bips + vibration + titre qui clignote. */
    tonTour() {
      jouerNotes([[988, 0.12], [0, 0.06], [1319, 0.25]]);
      navigator.vibrate?.([150, 80, 150]);
      clignoterTitre('👉 À toi de jouer !');
    },
    /** Départ de la partie. */
    depart() {
      jouerNotes([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]]);
      navigator.vibrate?.(300);
      clignoterTitre('⚔ La partie commence !');
    },
  };

  /** Envoie un événement et attend la réponse du serveur. */
  LW.emettre = (ev, donnees = {}) => new Promise((resolve) => {
    LW._socket.timeout(8000).emit(ev, donnees, (err, rep) => resolve(err ? { ok: false, erreur: 'Pas de réponse du serveur.' } : rep));
  });
})();
