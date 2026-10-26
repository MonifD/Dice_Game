/**
 * Point d'entrée : serveur HTTP + Express + Socket.IO.
 *
 *  - En local / Render / Railway : `npm start` exécute ce fichier qui écoute sur PORT.
 *  - Sur Vercel : api/server.js importe `serveur` (sans listen), Vercel s'occupe de l'écoute.
 */
const http = require('http');
const config = require('./config');
const { creerApp } = require('./app');
const { creerServeurSocket } = require('./socket');
const { assurerSuperAdmin } = require('./services/authService');

let io = null;
const app = creerApp(() => io);
const serveur = http.createServer(app);
io = creerServeurSocket(serveur);

assurerSuperAdmin().catch((e) => console.error('[demarrage] super admin :', e.message));

if (require.main === module) {
  serveur.listen(config.port, () => {
    console.log(`Last War — jeux d'élimination : http://localhost:${config.port}`);
  });
  const arret = () => { console.log('Arrêt…'); io.close(); serveur.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', arret);
  process.on('SIGINT', arret);
}

module.exports = { serveur, app, io };
