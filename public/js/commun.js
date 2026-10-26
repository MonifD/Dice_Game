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
    if (!rep.ok) throw new Error(donnees.erreur || `Erreur ${rep.status}`);
    return donnees;
  };

  // ---------------------------------------------------------- droits (miroir de src/services/permissions.js, pour l'affichage seulement)
  LW.estAdmin = (j) => j && (j.role === 'ADMIN' || j.role === 'SUPER_ADMIN');
  LW.estSuperAdmin = (j) => j && j.role === 'SUPER_ADMIN';
  LW.peutOrganiser = (j) => j && (LW.estAdmin(j) || j.rang === 'R4' || j.rang === 'R5');
  LW.libelleRole = (j) => (j.role === 'SUPER_ADMIN' ? 'Super admin' : j.role === 'ADMIN' ? 'Admin' : '');

  /** Charge le joueur connecté ; redirige vers la connexion si besoin. */
  LW.session = async ({ obligatoire = true } = {}) => {
    try {
      const { joueur, jeton } = await LW.api('/api/auth/moi');
      LW.moi = joueur;
      LW.jetonSocket = jeton;
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
    const liens = [
      ['accueil', '/accueil', 'Accueil'],
      ['historique', '/historique', 'Historique'],
      ...(LW.peutOrganiser(j) ? [['admin', '/admin', LW.estAdmin(j) ? 'Administration' : 'Organiser']] : []),
    ];
    const barre = LW.h(`
      <header class="barre">
        <a class="logo" href="/accueil"><span class="ecusson">⚔</span><span>Last War <span class="muet petit">Arène</span></span></a>
        <nav class="nav">${liens.map(([id, href, txt]) => `<a href="${href}" class="${id === pageActive ? 'actif' : ''}">${txt}</a>`).join('')}</nav>
        <div class="profil">
          <span class="badge or">${LW.echapper(j.rang)}</span>
          ${LW.libelleRole(j) ? `<span class="badge bleu">${LW.libelleRole(j)}</span>` : ''}
          <span class="pseudo">${LW.echapper(j.pseudo)}</span>
          <button class="btn lien petit" id="btn-deconnexion" title="Déconnexion">⏻</button>
        </div>
      </header>`);
    document.body.prepend(barre);
    LW.$('#btn-deconnexion').onclick = LW.deconnexion;
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
    socket.on('connect_error', (e) => { if (e.message === 'non_authentifie') location.href = '/'; });
    socket.on('disconnect', (raison) => {
      if (raison === 'io server disconnect') { LW.toast('Tu as été déconnecté par un admin.', 'erreur'); setTimeout(() => (location.href = '/'), 1500); }
    });
    LW._socket = socket;
    return socket;
  };

  /** Envoie un événement et attend la réponse du serveur. */
  LW.emettre = (ev, donnees = {}) => new Promise((resolve) => {
    LW._socket.timeout(8000).emit(ev, donnees, (err, rep) => resolve(err ? { ok: false, erreur: 'Pas de réponse du serveur.' } : rep));
  });
})();
