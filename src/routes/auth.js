/** Routes /api/auth : inscription, connexion, déconnexion, profil. */
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const auth = require('../services/authService');
const { exigerConnexionMdpTemporaire } = require('../middleware/auth');
const { journaliser } = require('../services/journal');

const router = express.Router();

const optionsCookie = () => ({
  httpOnly: true, // inaccessible au JavaScript du navigateur
  sameSite: config.origines.length ? 'none' : 'lax',
  secure: config.env === 'production',
  maxAge: 7 * 24 * 3600 * 1000,
  path: '/',
});

// Limitation des tentatives : 10 échecs / 15 min par IP + pseudo, et 100 requêtes / 15 min par IP.
const limiteParPseudo = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
  keyGenerator: (req) => `${rateLimit.ipKeyGenerator(req.ip)}|${auth.normaliserPseudo(req.body?.pseudo)}`,
  message: { erreur: 'Trop de tentatives. Réessaie dans 15 minutes.' },
  standardHeaders: 'draft-8', legacyHeaders: false,
});
const limiteParIp = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 100,
  message: { erreur: 'Trop de requêtes. Réessaie plus tard.' },
  standardHeaders: 'draft-8', legacyHeaders: false,
});

function repondreAvecSession(res, joueur, statut = 200) {
  const jeton = auth.creerJeton(joueur);
  res.cookie(config.cookieNom, jeton, optionsCookie());
  // le jeton est aussi renvoyé pour la connexion Socket.IO quand le temps réel est sur un autre domaine
  res.status(statut).json({ joueur: auth.profilPublic(joueur), jeton });
}

router.post('/inscription', limiteParIp, async (req, res, next) => {
  try {
    const j = await auth.inscrire(req.body?.pseudo, req.body?.motDePasse);
    await journaliser(j.id, 'inscription', { pseudo: j.pseudo });
    repondreAvecSession(res, j, 201);
  } catch (e) { next(e); }
});

router.post('/connexion', limiteParIp, limiteParPseudo, async (req, res, next) => {
  try {
    repondreAvecSession(res, await auth.connecter(req.body?.pseudo, req.body?.motDePasse));
  } catch (e) { next(e); }
});

router.post('/deconnexion', (req, res) => {
  res.clearCookie(config.cookieNom, { ...optionsCookie(), maxAge: undefined });
  res.json({ ok: true });
});

router.get('/moi', exigerConnexionMdpTemporaire, (req, res) => {
  res.json({ joueur: auth.profilPublic(req.joueur), jeton: auth.creerJeton(req.joueur, '1h') });
});

/**
 * Changer son mot de passe. Après un mot de passe temporaire (donné par un R4 / R5 / admin), l'ancien n'est pas
 * redemandé (le membre vient de se connecter avec), mais le nouveau doit être différent.
 */
router.post('/mot-de-passe', exigerConnexionMdpTemporaire, limiteParIp, async (req, res, next) => {
  try {
    const bcrypt = require('bcryptjs');
    const prisma = require('../db/prisma');
    const { ancien, nouveau } = req.body || {};
    if (!req.joueur.doitChangerMdp && !(await bcrypt.compare(String(ancien || ''), req.joueur.motDePasseHash))) {
      return res.status(400).json({ erreur: 'Ancien mot de passe incorrect.' });
    }
    auth.validerMotDePasse(nouveau);
    if (await bcrypt.compare(nouveau, req.joueur.motDePasseHash)) {
      return res.status(400).json({ erreur: 'Choisis un mot de passe différent de l\'actuel.' });
    }
    await prisma.joueur.update({
      where: { id: req.joueur.id }, data: { motDePasseHash: await bcrypt.hash(nouveau, auth.COUT_BCRYPT), doitChangerMdp: false },
    });
    if (req.joueur.doitChangerMdp) await journaliser(req.joueur.id, 'mot_de_passe_change', { joueur: req.joueur.pseudo });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
