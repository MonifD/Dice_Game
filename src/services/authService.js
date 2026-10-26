/**
 * Inscription, connexion et jetons JWT.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db/prisma');
const config = require('../config');

const COUT_BCRYPT = 10;

class ErreurAuth extends Error {
  constructor(message, statut = 400) { super(message); this.statut = statut; }
}

/** « Bob  Le  Grand » -> « bob le grand » : sert à garantir l'unicité. */
const normaliserPseudo = (p) => String(p || '').trim().replace(/\s+/g, ' ').toLowerCase();

function validerPseudo(pseudo) {
  const p = String(pseudo || '').trim().replace(/\s+/g, ' ');
  if (p.length < 2 || p.length > 24) throw new ErreurAuth('Le pseudo doit faire entre 2 et 24 caractères.');
  // Pseudos Last War : lettres (y compris accents et alphabets non latins), chiffres, quelques symboles.
  if (!/^[\p{L}\p{N} _.\-[\]()#|~★☆]+$/u.test(p)) throw new ErreurAuth('Le pseudo contient des caractères non autorisés.');
  return p;
}

function validerMotDePasse(mdp) {
  if (typeof mdp !== 'string' || mdp.length < 6 || mdp.length > 72) {
    throw new ErreurAuth('Le mot de passe doit faire entre 6 et 72 caractères.');
  }
  return mdp;
}

/** Données d'un joueur exposables au navigateur (jamais le hash !). */
function profilPublic(j) {
  return { id: j.id, pseudo: j.pseudo, rang: j.rang, role: j.role, actif: j.actif, dateInscription: j.dateInscription };
}

async function inscrire(pseudo, motDePasse) {
  const p = validerPseudo(pseudo);
  validerMotDePasse(motDePasse);
  const existe = await prisma.joueur.findUnique({ where: { pseudoNormalise: normaliserPseudo(p) } });
  if (existe) throw new ErreurAuth('Ce pseudo est déjà inscrit.', 409);
  const motDePasseHash = await bcrypt.hash(motDePasse, COUT_BCRYPT);
  try {
    return await prisma.joueur.create({
      data: { pseudo: p, pseudoNormalise: normaliserPseudo(p), motDePasseHash }, // R1 / JOUEUR par défaut
    });
  } catch (e) {
    if (e.code === 'P2002') throw new ErreurAuth('Ce pseudo est déjà inscrit.', 409);
    throw e;
  }
}

async function connecter(pseudo, motDePasse) {
  const j = await prisma.joueur.findUnique({ where: { pseudoNormalise: normaliserPseudo(pseudo) } });
  // Même message dans les deux cas pour ne pas révéler quels pseudos existent.
  const ok = j && (await bcrypt.compare(String(motDePasse || ''), j.motDePasseHash));
  if (!ok) throw new ErreurAuth('Pseudo ou mot de passe incorrect.', 401);
  if (!j.actif) throw new ErreurAuth('Ce compte est bloqué. Contacte un admin.', 403);
  await prisma.joueur.update({ where: { id: j.id }, data: { derniereConnexion: new Date() } });
  return j;
}

const creerJeton = (joueur, duree = config.jwtDuree) => jwt.sign({ sub: joueur.id }, config.jwtSecret, { expiresIn: duree });

/** Renvoie l'id du joueur ou null si le jeton est invalide/expiré. */
function lireJeton(jeton) {
  try { return jwt.verify(jeton, config.jwtSecret).sub; } catch { return null; }
}

/** Charge le joueur à partir d'un jeton, refuse les comptes bloqués/supprimés. */
async function joueurDepuisJeton(jeton) {
  const id = jeton && lireJeton(jeton);
  if (!id) return null;
  const j = await prisma.joueur.findUnique({ where: { id } });
  return j && j.actif ? j : null;
}

/** Crée le super admin défini dans les variables d'environnement s'il n'existe pas. */
async function assurerSuperAdmin() {
  if (!config.superAdminPseudo) return;
  const pn = normaliserPseudo(config.superAdminPseudo);
  const j = await prisma.joueur.findUnique({ where: { pseudoNormalise: pn } });
  if (j) {
    if (j.role !== 'SUPER_ADMIN') await prisma.joueur.update({ where: { id: j.id }, data: { role: 'SUPER_ADMIN', rang: 'R5' } });
    return;
  }
  if (!config.superAdminMotDePasse) {
    console.warn('[auth] SUPER_ADMIN_MOT_DE_PASSE absent : inscris-toi avec le pseudo du super admin puis redémarre.');
    return;
  }
  await prisma.joueur.create({
    data: {
      pseudo: validerPseudo(config.superAdminPseudo), pseudoNormalise: pn, role: 'SUPER_ADMIN', rang: 'R5',
      motDePasseHash: await bcrypt.hash(config.superAdminMotDePasse, COUT_BCRYPT),
    },
  });
  console.log(`[auth] Super admin « ${config.superAdminPseudo} » créé.`);
}

module.exports = {
  ErreurAuth, inscrire, connecter, creerJeton, lireJeton, joueurDepuisJeton,
  profilPublic, normaliserPseudo, validerMotDePasse, assurerSuperAdmin, COUT_BCRYPT,
};
