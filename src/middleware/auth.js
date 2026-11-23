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

const MESSAGE_CHANGER_MDP = 'Ton mot de passe a été réinitialisé : choisis un nouveau mot de passe pour continuer.';

/**
 * Exige un joueur connecté et actif ; le place dans req.joueur.
 * Un membre qui a reçu un mot de passe temporaire doit d'abord le changer (HTTP 403, code « changer_mdp »),
 * sauf sur les routes créées avec { mdpTemporaire: true } (profil, changement de mot de passe).
 */
const connexion = ({ mdpTemporaire = false } = {}) => async (req, res, next) => {
  try {
    const joueur = await joueurDepuisJeton(extraireJeton(req));
    if (!joueur) return res.status(401).json({ erreur: 'Connexion requise.' });
    if (joueur.doitChangerMdp && !mdpTemporaire) return res.status(403).json({ erreur: MESSAGE_CHANGER_MDP, code: 'changer_mdp' });
    req.joueur = joueur;
    next();
  } catch (e) { next(e); }
};
const exigerConnexion = connexion();
/** Connexion obligatoire, même avec un mot de passe temporaire pas encore changé. */
const exigerConnexionMdpTemporaire = connexion({ mdpTemporaire: true });

const exiger = (regle, message) => (req, res, next) =>
  regle(req.joueur) ? next() : res.status(403).json({ erreur: message || 'Droits insuffisants.' });

module.exports = {
  extraireJeton,
  exigerConnexion,
  exigerConnexionMdpTemporaire,
  MESSAGE_CHANGER_MDP,
  exigerOrganisateur: exiger(perms.peutOrganiser, 'Réservé aux R4, R5 et admins.'),
  exigerAdmin: exiger(perms.estAdmin, 'Réservé aux admins.'),
  exigerSuperAdmin: exiger(perms.estSuperAdmin, 'Réservé au super admin.'),
  /** Super admin ou R5 (mêmes droits). */
  exigerDroitsSuperAdmin: exiger(perms.aDroitsSuperAdmin, 'Réservé au R5 et au super admin.'),
  /** Nommer / retirer des admins : R4 admin, R5, super admin. */
  exigerChangerRoles: exiger(perms.peutChangerRoles, 'Réservé aux R4 admin, au R5 et au super admin.'),
};
