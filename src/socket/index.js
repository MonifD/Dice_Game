/**
 * Échanges temps réel Socket.IO (voir ARCHITECTURE.md pour la liste complète).
 *
 * Client -> serveur (toujours avec accusé de réception : cb({ ok, ... }) ) :
 *   salle:observer   { code }            rejoint la salle (joueur ou spectateur) et reçoit l'état
 *   salle:inscrire   { code }            s'inscrire en salle d'attente
 *   salle:quitter    { code }            quitter la salle d'attente
 *   salle:pret       { code, pret }      se déclarer prêt (ou plus prêt) en salle d'attente
 *   salle:alerter    { code }            (organisateur) faire sonner l'alerte chez tous les joueurs
 *   salle:exclure    { code, joueurId }  (organisateur) retirer quelqu'un de la salle d'attente
 *   salle:lancer     { code }            (organisateur) lancer la partie
 *   salle:suivant    { code }            (organisateur) finir le tour / lancer le tour suivant
 *   salle:arreter    { code }            (organisateur) arrêter la partie
 *   jeu:action       { code, donnees }   jouer son coup
 *   jeu:orga         { code, donnees }   (organisateur) réglage du mini-jeu pour le prochain tour (ex. options A / B)
 *   jeu:orgaPause    { code }            (organisateur) suspend le compte à rebours pendant qu'il modifie un réglage
 *   accueil:suivre   {}                  recevoir les mises à jour de la liste des salles
 *   chat:rejoindre   { canal }           'general' ou 'salle:<code>' -> 100 derniers messages
 *   chat:quitter     { canal }
 *   chat:envoyer     { canal, texte }
 *   chat:supprimer   { canal, id }       auteur, R4/R5/admins
 *   chat:muet        { joueurId, minutes } admins (0 = lever la sanction)
 *
 * Serveur -> client :
 *   salle:etat, salle:inscription, salle:desinscription, salle:pret, salle:alerte, jeu:aAgi, jeu:evenement, salles:maj,
 *   chat:message, chat:supprime, chat:muet
 */
const { Server } = require('socket.io');
const cookie = require('cookie');
const config = require('../config');
const moteur = require('../moteur/moteur');
const { joueurDepuisJeton } = require('../services/authService');
const { stockage } = require('../db/stockage');
const prisma = require('../db/prisma');
const chat = require('../services/chatService');
const { journaliser } = require('../services/journal');

const CODE_VALIDE = /^[A-Z0-9]{4,8}$/;

function normaliserCode(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!CODE_VALIDE.test(c)) { const e = new Error('Code de salle invalide.'); e.estErreurJeu = true; throw e; }
  return c;
}

/** Enveloppe un gestionnaire : erreurs propres, accusé de réception systématique, anti-spam simple. */
function gestionnaire(socket, fn) {
  return async (donnees, cb) => {
    if (typeof donnees === 'function') { cb = donnees; donnees = {}; }
    const repondre = typeof cb === 'function' ? cb : () => {};
    // limite : 30 messages par seconde et par connexion (la course de clics envoie par paquets)
    const now = Date.now();
    socket.data.fenetre = socket.data.fenetre && now - socket.data.fenetre.debut < 1000
      ? socket.data.fenetre : { debut: now, n: 0 };
    if (++socket.data.fenetre.n > 30) return repondre({ ok: false, erreur: 'Trop de messages, ralentis.' });
    try {
      const r = await fn(donnees || {});
      repondre({ ok: true, ...(r || {}) });
    } catch (e) {
      if (!e.estErreurJeu) console.error('[socket]', e);
      repondre({ ok: false, erreur: e.estErreurJeu ? e.message : 'Erreur serveur, réessaie.' });
    }
  };
}

function creerServeurSocket(httpServer) {
  const io = new Server(httpServer, {
    path: config.socketPath,
    transports: ['websocket'], // requis sur Vercel ; marche aussi partout ailleurs
    cors: config.origines.length ? { origin: config.origines, credentials: true } : undefined,
    pingInterval: 20000,
    pingTimeout: 20000,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });

  // Adaptateur Redis : les messages atteignent les joueurs connectés à n'importe quelle instance.
  if (stockage.type === 'redis') {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pub = stockage.dupliquer();
    const sub = stockage.dupliquer();
    io.adapter(createAdapter(pub, sub));
    console.log('[socket] adaptateur Redis activé');
  }

  // Authentification à la connexion : jeton (handshake.auth.token) ou cookie de session.
  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      const jeton = socket.handshake.auth?.token || cookies[config.cookieNom];
      const joueur = await joueurDepuisJeton(jeton);
      if (!joueur) return next(new Error('non_authentifie'));
      socket.data.joueur = { id: String(joueur.id), pseudo: joueur.pseudo, rang: joueur.rang, role: joueur.role };
      next();
    } catch (e) { next(e); }
  });

  io.on('connection', (socket) => {
    const moi = socket.data.joueur;
    socket.join(`joueur:${moi.id}`); // permet de déconnecter un compte bloqué

    socket.on('accueil:suivre', gestionnaire(socket, async () => { socket.join('accueil'); }));

    socket.on('salle:observer', gestionnaire(socket, async ({ code }) => {
      const c = normaliserCode(code);
      const vue = await moteur.vueClient(c);
      if (!vue) { const e = new Error('Salle introuvable.'); e.estErreurJeu = true; throw e; }
      for (const r of socket.rooms) if (r.startsWith('salle:') && r !== `salle:${c}`) socket.leave(r);
      socket.join(`salle:${c}`);
      return { etat: vue, moi };
    }));

    socket.on('salle:inscrire', gestionnaire(socket, async ({ code }) => moteur.inscrire(normaliserCode(code), moi)));
    socket.on('salle:quitter', gestionnaire(socket, async ({ code }) => { await moteur.desinscrire(normaliserCode(code), moi.id); }));
    socket.on('salle:pret', gestionnaire(socket, async ({ code, pret }) => moteur.definirPret(normaliserCode(code), moi.id, pret !== false)));
    socket.on('salle:alerter', gestionnaire(socket, async ({ code }) => { await moteur.alerter(normaliserCode(code), moi.id); }));
    socket.on('salle:exclure', gestionnaire(socket, async ({ code, joueurId }) => {
      await moteur.desinscrire(normaliserCode(code), joueurId, moi.id);
    }));
    socket.on('salle:lancer', gestionnaire(socket, async ({ code }) => { await moteur.lancer(normaliserCode(code), moi.id); }));
    socket.on('salle:suivant', gestionnaire(socket, async ({ code }) => { await moteur.suivant(normaliserCode(code), moi.id); }));
    socket.on('salle:arreter', gestionnaire(socket, async ({ code }) => { await moteur.arreter(normaliserCode(code), moi.id); }));
    socket.on('jeu:orga', gestionnaire(socket, async ({ code, donnees }) => { await moteur.commandeOrga(normaliserCode(code), moi.id, donnees); }));
    socket.on('jeu:orgaPause', gestionnaire(socket, async ({ code }) => { await moteur.pauseReglage(normaliserCode(code), moi.id); }));
    socket.on('jeu:action', gestionnaire(socket, async ({ code, donnees }) => moteur.agir(normaliserCode(code), moi.id, donnees)));

    // ------------------------------------------------------------ chat
    /** Vérifie que le salon existe (général, ou salle encore connue). */
    async function canalValide(canal) {
      const c = chat.verifierCanal(canal);
      if (c.startsWith('salle:') && !(await moteur.lire(c.slice(6)))) {
        const e = new Error('Cette salle n\'existe plus.'); e.estErreurJeu = true; throw e;
      }
      return c;
    }
    /** Données fraîches du joueur (rang/rôle à jour pour la modération). */
    async function moiFrais() {
      const j = await prisma.joueur.findUnique({ where: { id: Number(moi.id) } });
      if (!j || !j.actif) { const e = new Error('Compte inactif.'); e.estErreurJeu = true; throw e; }
      Object.assign(moi, { pseudo: j.pseudo, rang: j.rang, role: j.role });
      return j;
    }

    socket.on('chat:rejoindre', gestionnaire(socket, async ({ canal }) => {
      const c = await canalValide(canal);
      socket.join(`chat:${c}`);
      return { messages: await chat.historique(c), muetMs: await chat.restantMuet(moi.id) };
    }));
    socket.on('chat:quitter', gestionnaire(socket, async ({ canal }) => { socket.leave(`chat:${chat.verifierCanal(canal)}`); }));
    socket.on('chat:envoyer', gestionnaire(socket, async ({ canal, texte }) => {
      const c = await canalValide(canal);
      const message = await chat.envoyer(c, moi, texte);
      io.to(`chat:${c}`).emit('chat:message', message);
      return { id: message.id };
    }));
    socket.on('chat:supprimer', gestionnaire(socket, async ({ canal, id }) => {
      const c = chat.verifierCanal(canal);
      const m = await chat.supprimer(c, String(id || ''), await moiFrais());
      io.to(`chat:${c}`).emit('chat:supprime', { canal: c, id: m.id });
      await journaliser(moi.id, 'chat_supprimer', { canal: c, auteur: m.auteur.pseudo, texte: m.texte });
    }));
    socket.on('chat:muet', gestionnaire(socket, async ({ joueurId, minutes }) => {
      const auteur = await moiFrais();
      const cible = await prisma.joueur.findUnique({ where: { id: Number(joueurId) } });
      if (!cible) { const e = new Error('Joueur introuvable.'); e.estErreurJeu = true; throw e; }
      const m = await chat.rendreMuet(cible, minutes, auteur);
      io.to(`joueur:${cible.id}`).emit('chat:muet', { muetMs: m * 60000 });
      await journaliser(moi.id, m ? 'chat_muet' : 'chat_muet_leve', { joueur: cible.pseudo, minutes: m });
      return { minutes: m, pseudo: cible.pseudo };
    }));
  });

  moteur.attacher(io);
  return io;
}

module.exports = { creerServeurSocket };
