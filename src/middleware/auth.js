/** Middlewares Express d'authentification et de droits. */
const config = require('../config');
const { joueurDepuisJeton } = require('../services/authService');
const perms = require('../services/permissions');

/** Récupère le jeton : cookie httpOnly (navigateur) ou en-tête Authorization (outils / tests). */
function extraireJeton(req) {
  if (req.cookies?.[config.cookieNom]) return req.cookies[config.cookieNom];
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Exige un joueur connecté et actif ; le place dans req.joueur. */
async function exigerConnexion(req, res, next) {
  try {
    const joueur = await joueurDepuisJeton(extraireJeton(req));
    if (!joueur) return res.status(401).json({ erreur: 'Connexion requise.' });
    req.joueur = joueur;
    next();
  } catch (e) { next(e); }
}

const exiger = (regle, message) => (req, res, next) =>
  regle(req.joueur) ? next() : res.status(403).json({ erreur: message || 'Droits insuffisants.' });

module.exports = {
  extraireJeton,
  exigerConnexion,
  exigerOrganisateur: exiger(perms.peutOrganiser, 'Réservé aux R4, R5 et admins.'),
  exigerAdmin: exiger(perms.estAdmin, 'Réservé aux admins.'),
  exigerSuperAdmin: exiger(perms.estSuperAdmin, 'Réservé au super admin.'),
};
