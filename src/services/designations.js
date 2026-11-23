/**
 * Désignations Conducteur / VIP du train, par jour J.
 *
 *  - une ligne par changement (table « designations ») ; la ligne active d'un (objet, jour) est celle en vigueur ;
 *  - fin d'une partie Conducteur / VIP : le gagnant REMPLACE la personne déjà désignée pour ce rôle et ce jour ;
 *  - un R4, R5 ou admin peut modifier ou retirer une désignation à la main (ancien nom, nouveau nom, auteur, date) ;
 *  - compte supprimé : ses désignations du jour et à venir passent à « Non désigné ».
 * Les changements d'un même (objet, jour) sont sérialisés par un verrou PostgreSQL (pg_advisory_xact_lock).
 */
const prisma = require('../db/prisma');
const jour = require('./jour');
const { journaliser } = require('./journal');

const OBJETS_DESIGNATION = ['CONDUCTEUR', 'VIP'];
const LIBELLES = { CONDUCTEUR: 'Conducteur du train', VIP: 'VIP du train' };

class ErreurDesignation extends Error {
  constructor(message, statut = 400) { super(message); this.statut = statut; }
}

/** Nom affiché d'un joueur (« X (compte supprimé) » pour un compte supprimé). */
function nomAffiche(j) {
  if (!j) return null;
  if (!j.supprimeLe) return j.pseudo;
  return j.pseudoSupprime ? `${j.pseudoSupprime} (compte supprimé)` : '(compte supprimé)';
}
/** { id, pseudo, supprime } pour le navigateur. */
const joueurPublic = (j) => (j ? { id: j.id, pseudo: nomAffiche(j), supprime: !!j.supprimeLe } : null);
const SELECT_JOUEUR = { id: true, pseudo: true, supprimeLe: true, pseudoSupprime: true };

async function verrouiller(tx, objet, j) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`designation:${objet}:${j}`}))`;
}

/**
 * Remplace la désignation active d'un (objet, jour) par une nouvelle ligne.
 * @returns {{ avant: object|null, apres: object }}
 */
async function remplacer({ objet, jourJ, joueurId = null, mode, partieId = null, auteurId = null }, tx) {
  await verrouiller(tx, objet, jourJ);
  const date = jour.versDate(jourJ);
  const avant = await tx.designation.findFirst({
    where: { objet, jour: date, active: true }, orderBy: { creeLe: 'desc' }, include: { joueur: { select: SELECT_JOUEUR } },
  });
  const maintenant = new Date();
  await tx.designation.updateMany({ where: { objet, jour: date, active: true }, data: { active: false, remplaceeLe: maintenant } });
  const apres = await tx.designation.create({
    data: {
      objet, jour: date, joueurId, mode, partieId, auteurId, active: true, creeLe: maintenant,
      ancienPseudo: avant?.joueur ? (avant.joueur.pseudoSupprime || avant.joueur.pseudo) : null,
    },
    include: { joueur: { select: SELECT_JOUEUR } },
  });
  return { avant, apres };
}

/** Fin d'une partie Conducteur / VIP : le gagnant devient la désignation du jour J (remplace la précédente). */
async function attribuerGagnant({ objet, jourJ, joueurId, partieId }) {
  if (!OBJETS_DESIGNATION.includes(objet) || !jour.estJour(jourJ)) return null;
  return prisma.$transaction((tx) => remplacer({ objet, jourJ, joueurId: Number(joueurId), mode: 'PARTIE', partieId }, tx));
}

/** Modification / retrait manuel (R4, R5, admins — droits vérifiés par la route). joueurId null = retirer. */
async function modifier({ objet, jourJ, joueurId, auteur }) {
  if (!OBJETS_DESIGNATION.includes(objet)) throw new ErreurDesignation('Choisis Conducteur ou VIP.');
  if (!jour.estJour(jourJ)) throw new ErreurDesignation('Date invalide.');
  if (Math.abs(jour.ecartJours(jour.aujourdhui(), jourJ)) > 366) throw new ErreurDesignation('La date doit être à moins d\'un an d\'aujourd\'hui.');
  let cible = null;
  if (joueurId !== null && joueurId !== undefined && joueurId !== '') {
    cible = await prisma.joueur.findUnique({ where: { id: Number(joueurId) } });
    if (!cible || cible.supprimeLe) throw new ErreurDesignation('Joueur introuvable.', 404);
  }
  const r = await prisma.$transaction(async (tx) => {
    const actuelle = await tx.designation.findFirst({ where: { objet, jour: jour.versDate(jourJ), active: true } });
    if ((actuelle?.joueurId ?? null) === (cible?.id ?? null)) throw new ErreurDesignation(cible ? `${cible.pseudo} est déjà désigné(e) pour ce jour.` : 'Personne n\'est désigné pour ce jour.');
    return remplacer({ objet, jourJ, joueurId: cible?.id ?? null, mode: 'MANUELLE', auteurId: auteur.id }, tx);
  });
  await journaliser(auteur.id, cible ? 'designation_modifiee' : 'designation_retiree', {
    role: LIBELLES[objet], jour: jourJ, ancien: r.avant?.joueur ? nomAffiche(r.avant.joueur) : 'Non désigné', nouveau: cible ? cible.pseudo : 'Non désigné',
  });
  return r.apres;
}

/** Compte supprimé : ses désignations actives du jour et à venir passent à « Non désigné ». */
async function retirerCompteSupprime(joueurId, auteurId) {
  const aRetirer = await prisma.designation.findMany({
    where: { joueurId: Number(joueurId), active: true, jour: { gte: jour.versDate(jour.aujourdhui()) } },
  });
  for (const d of aRetirer) {
    await prisma.$transaction((tx) => remplacer({ objet: d.objet, jourJ: jour.depuisDate(d.jour), joueurId: null, mode: 'SUPPRESSION', auteurId }, tx));
  }
  return aRetirer.length;
}

/** Désignations en vigueur pour un jour (bandeaux de l'accueil) : { CONDUCTEUR: {...}|null, VIP: {...}|null }. */
async function duJour(jourJ = jour.aujourdhui(), registre = null) {
  const lignes = await prisma.designation.findMany({
    where: { jour: jour.versDate(jourJ), active: true, objet: { in: OBJETS_DESIGNATION } },
    include: { joueur: { select: SELECT_JOUEUR } }, orderBy: { creeLe: 'desc' },
  });
  const partieIds = lignes.map((l) => l.partieId).filter(Boolean);
  const parties = partieIds.length ? await prisma.partie.findMany({ where: { id: { in: partieIds } }, select: { id: true, miniJeu: true } }) : [];
  const jeuDe = Object.fromEntries(parties.map((p) => [p.id, p.miniJeu]));
  const res = {};
  for (const objet of OBJETS_DESIGNATION) {
    const l = lignes.find((x) => x.objet === objet);
    const mod = l?.partieId && registre ? registre.obtenir(jeuDe[l.partieId]) : null;
    res[objet] = l && l.joueur ? {
      joueur: joueurPublic(l.joueur), jour: jourJ, mode: l.mode,
      miniJeu: mod ? mod.nom : (jeuDe[l?.partieId] || null), icone: mod?.icone || null,
    } : null;
  }
  return res;
}

/**
 * Historique des désignations :
 *  - aVenir : désignations en vigueur du jour en cours et des jours suivants ;
 *  - journal : toutes les lignes récentes, avec leur statut (en vigueur, « remplacé », « modifié par … »).
 */
async function historique({ registre = null, limite = 200 } = {}) {
  const auj = jour.aujourdhui();
  const [aVenir, lignes] = await Promise.all([
    prisma.designation.findMany({
      where: { active: true, jour: { gte: jour.versDate(auj) } }, orderBy: [{ jour: 'asc' }, { objet: 'asc' }],
      include: { joueur: { select: SELECT_JOUEUR } }, take: 100,
    }),
    prisma.designation.findMany({ orderBy: [{ creeLe: 'desc' }, { id: 'desc' }], include: { joueur: { select: SELECT_JOUEUR } }, take: limite }),
  ]);
  const auteurIds = [...new Set(lignes.map((l) => l.auteurId).filter(Boolean))];
  const partieIds = [...new Set([...lignes, ...aVenir].map((l) => l.partieId).filter(Boolean))];
  const [auteurs, parties] = await Promise.all([
    auteurIds.length ? prisma.joueur.findMany({ where: { id: { in: auteurIds } }, select: SELECT_JOUEUR }) : [],
    partieIds.length ? prisma.partie.findMany({ where: { id: { in: partieIds } }, select: { id: true, miniJeu: true } }) : [],
  ]);
  const auteurDe = Object.fromEntries(auteurs.map((a) => [a.id, nomAffiche(a)]));
  const jeuDe = Object.fromEntries(parties.map((p) => [p.id, p.miniJeu]));
  const jeu = (partieId) => {
    if (!partieId) return null;
    const m = registre?.obtenir(jeuDe[partieId]);
    return { nom: m?.nom || jeuDe[partieId] || '?', icone: m?.icone || '🎮' };
  };
  // ligne qui a remplacé chaque ligne inactive : la suivante du même (objet, jour)
  const parCle = new Map();
  for (const l of [...lignes].sort((a, b) => a.creeLe - b.creeLe || a.id - b.id)) {
    const cle = `${l.objet}|${jour.depuisDate(l.jour)}`;
    if (!parCle.has(cle)) parCle.set(cle, []);
    parCle.get(cle).push(l);
  }
  const remplacante = new Map();
  for (const liste of parCle.values()) liste.forEach((l, i) => { if (liste[i + 1]) remplacante.set(l.id, liste[i + 1]); });

  const vers = (l) => {
    const r = remplacante.get(l.id);
    let statut = l.active ? 'en_vigueur' : 'remplace';
    let modifiePar = null;
    if (!l.active && r && r.mode === 'MANUELLE') { statut = 'modifie'; modifiePar = auteurDe[r.auteurId] || null; }
    return {
      id: l.id, objet: l.objet, jour: jour.depuisDate(l.jour), mode: l.mode, active: l.active,
      joueur: joueurPublic(l.joueur), ancienPseudo: l.ancienPseudo, auteur: auteurDe[l.auteurId] || null,
      date: l.creeLe, remplaceeLe: l.remplaceeLe, statut, modifiePar, jeu: jeu(l.partieId),
    };
  };
  return {
    aujourdhui: auj,
    aVenir: aVenir.map((l) => ({ ...vers(l), statut: 'en_vigueur' })),
    journal: lignes.map(vers),
  };
}

module.exports = {
  OBJETS_DESIGNATION, ErreurDesignation, nomAffiche, joueurPublic, SELECT_JOUEUR,
  attribuerGagnant, modifier, retirerCompteSupprime, duJour, historique,
};
