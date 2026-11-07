/**
 * Règles de droits — utilisées PARTOUT côté serveur (routes HTTP et Socket.IO).
 * Le navigateur ne fait que masquer des boutons : la vraie vérification est ici.
 *
 * Niveaux (du plus haut au plus bas) :
 *  4  SUPER_ADMIN : tout ; personne ne peut le modifier
 *  3  R5          : mêmes droits que le super admin (admin ou non). Un seul R5 à la fois (hors super admin) :
 *                   donner R5 à quelqu'un est une passation, l'ancien R5 redescend R4
 *  2  R4 + ADMIN  : rangs R1..R4 et rôles (nommer / retirer des admins) + droits d'un admin
 *  1  ADMIN       : rangs R1..R4, bloquer / supprimer des comptes, quiz, modération du chat
 *                   (R3 minimum : un R1 ou un R2 ne peut pas être admin ; un ancien admin R1/R2 n'a aucun droit)
 *  0  joueurs (R4 / R5 sans admin : créer et mener des parties ; R1..R3 : joueurs simples)
 *
 * On ne modifie que les comptes d'un niveau STRICTEMENT inférieur au sien, jamais le sien,
 * et on ne peut pas faire monter quelqu'un au-dessus de son propre niveau.
 */

const estSuperAdmin = (j) => j?.role === 'SUPER_ADMIN';
const estR5 = (j) => j?.rang === 'R5';
/** Rangs trop bas pour être admin. */
const RANGS_SANS_ADMIN = ['R1', 'R2'];
const peutEtreAdmin = (rang) => !RANGS_SANS_ADMIN.includes(rang);

function niveau(j) {
  if (!j) return 0;
  if (estSuperAdmin(j)) return 4;
  if (estR5(j)) return 3;
  if (j.role === 'ADMIN' && peutEtreAdmin(j.rang)) return j.rang === 'R4' ? 2 : 1;
  return 0;
}

/** Accès à l'administration (comptes, quiz) et modération : admins, R5, super admin. */
const estAdmin = (j) => niveau(j) >= 1;
/** Droits du super admin : le super admin et le R5 (journaux, rang R5…). */
const aDroitsSuperAdmin = (j) => niveau(j) >= 3;
/** Peut nommer / retirer des admins : R4 admin, R5, super admin. */
const peutChangerRoles = (j) => niveau(j) >= 2;

/** Peut créer / lancer / arrêter des parties. */
const peutOrganiser = (j) => !!j && j.actif !== false && (estAdmin(j) || j.rang === 'R4' || j.rang === 'R5');

/** Peut gérer les comptes (rangs, blocage, suppression) et les questions du quiz. */
const peutGererComptes = (j) => estAdmin(j);

/** L'auteur peut-il modifier le compte cible ? (jamais soi-même, seulement plus bas que soi) */
function peutModifierCompte(auteur, cible) {
  if (!auteur || !cible || auteur.id === cible.id || auteur.actif === false) return false;
  return niveau(auteur) >= 1 && niveau(cible) < niveau(auteur);
}

/**
 * Le compte cible peut-il recevoir ce rang / ce rôle de la part de l'auteur ?
 * Le niveau obtenu ne doit pas dépasser celui de l'auteur ; seuls le super admin et le R5 donnent R5.
 * @returns {string|null} message d'erreur, ou null si c'est permis
 */
function refusChangement(auteur, cible, { rang = cible.rang, role = cible.role } = {}) {
  if (!peutModifierCompte(auteur, cible)) return 'Tu ne peux pas modifier ce compte.';
  if (role === 'ADMIN' && !peutEtreAdmin(rang)) return 'Un R1 ou un R2 ne peut pas être admin : passe-le d\'abord R3 ou plus.';
  if (role !== cible.role && !peutChangerRoles(auteur)) return 'Seuls les R4 admin, le R5 et le super admin nomment des admins.';
  if (rang === 'R5' && rang !== cible.rang && !aDroitsSuperAdmin(auteur)) return 'Seuls le R5 et le super admin peuvent donner le rang R5.';
  if (niveau({ ...cible, rang, role }) > niveau(auteur)) return 'Tu ne peux pas donner plus de droits que les tiens.';
  return null;
}

/** Rangs que l'auteur peut proposer (pour l'affichage). */
const rangsPossibles = (auteur) => (aDroitsSuperAdmin(auteur) ? ['R1', 'R2', 'R3', 'R4', 'R5'] : ['R1', 'R2', 'R3', 'R4']);

module.exports = {
  niveau, estSuperAdmin, estR5, peutEtreAdmin, estAdmin, aDroitsSuperAdmin, peutChangerRoles,
  peutOrganiser, peutGererComptes, peutModifierCompte, refusChangement, rangsPossibles,
};
