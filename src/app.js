/** Application Express : API + pages statiques + scripts client des mini-jeux. */
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const registre = require('./minijeux');
const version = require('./services/version');

function creerApp(obtenirIo) {
  const app = express();
  app.set('trust proxy', 1); // derrière Vercel / Render : vraie IP pour la limitation des tentatives
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // En-têtes de sécurité simples
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // CORS si le site est servi depuis un autre domaine que l'API
  if (config.origines.length) {
    app.use((req, res, next) => {
      const o = req.headers.origin;
      if (o && config.origines.includes(o)) {
        res.setHeader('Access-Control-Allow-Origin', o);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
      }
      next();
    });
  }

  /**
   * Santé du serveur : utilisée par Render (healthcheck) et par la pipeline de livraison
   * (quelle version tourne ? une partie est-elle en cours ? -> on ne déploie pas pendant une partie).
   * Ne renvoie que des compteurs, aucune donnée de joueur.
   */
  app.get('/api/sante', async (req, res) => {
    let activite = { partiesEnCours: null, sallesAttente: null };
    try { activite = await require('./moteur/moteur').activite(); } catch { /* stockage indisponible */ }
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, version: version.version, commit: version.commit, ...activite, heure: Date.now() });
  });
  // Configuration publique utilisée par le navigateur (où se connecter en temps réel)
  app.get('/api/config', (req, res) => res.json({ socketPath: config.socketPath, urlTempsReel: config.urlTempsReel, version: version.version }));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/admin', require('./routes/admin')(obtenirIo));
  app.use('/api', require('./routes/parties'));

  // Script d'affichage de chaque mini-jeu : src/minijeux/<id>/client.js
  app.get('/minijeux/:id/client.js', (req, res) => {
    const fichier = req.params.id === '_departage'
      ? path.join(__dirname, 'moteur', 'departage.client.js')
      : registre.obtenir(req.params.id) && path.join(registre.obtenir(req.params.id).dossier, 'client.js');
    if (!fichier || !fs.existsSync(fichier)) return res.status(404).type('js').send('// mini-jeu inconnu');
    res.type('application/javascript').sendFile(fichier);
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: config.env === 'production' ? '1h' : 0 }));

  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Route inconnue.' }));

  // Gestion d'erreurs : message clair pour les erreurs « métier », générique sinon.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.estErreurJeu || err.statut) return res.status(err.statut || 400).json({ erreur: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'Requête invalide.' });
    console.error('[http]', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  });

  return app;
}

module.exports = { creerApp };
