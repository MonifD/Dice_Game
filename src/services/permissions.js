/**
 * Règles de droits — utilisées PARTOUT côté serveur (routes HTTP et Socket.IO).
 * Le navigateur ne fait que masquer des boutons : la vraie vérification est ici.
 *
 *  SUPER_ADMIN : tout (gestion des admins, configuration, journaux)
 *  ADMIN       : rangs R1..R5, bloquer/supprimer des comptes + droits R4/R5 sur les parties
 *  R4 / R5     : créer, paramétrer, lancer, faire avancer et arrêter une partie
 *  R1 / R2 / R3: joueurs simples
 */

const estSuperAdmin = (j) => j?.role === 'SUPER_ADMIN';
const estAdmin = (j) => j?.role === 'ADMIN' || estSuperAdmin(j);

/** Peut créer / lancer / arrêter des parties. */
const peutOrganiser = (j) => !!j && j.actif !== false && (estAdmin(j) || j.rang === 'R4' || j.rang === 'R5');

/** Peut gérer les comptes (rangs, blocage, suppression) et les questions du quiz. */
const peutGererComptes = (j) => estAdmin(j);

/**
 * L'auteur peut-il modifier le compte cible ?
 * - personne ne se modifie soi-même par l'administration (évite de se bloquer) ;
 * - un admin ne touche ni aux admins ni au super admin ;
 * - le super admin peut tout, sauf un autre super admin.
 */
function peutModifierCompte(auteur, cible) {
  if (!auteur || !cible || auteur.id === cible.id) return false;
  if (estSuperAdmin(cible)) return false;
  if (estSuperAdmin(auteur)) return true;
  if (estAdmin(auteur)) return cible.role === 'JOUEUR';
  return false;
}

module.exports = { estSuperAdmin, estAdmin, peutOrganiser, peutGererComptes, peutModifierCompte };
