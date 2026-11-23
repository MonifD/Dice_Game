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
async function remplacer({ objet, jourJ, joueurId = null, mode, partieId = null, auteurId = null, maintenant = new Date() }, tx) {
  await verrouiller(tx, objet, jourJ);
  const date = jour.versDate(jourJ);
  const avant = await tx.designation.findFirst({
    where: { objet, jour: date, active: true }, orderBy: { creeLe: 'desc' }, include: { joueur: { select: SELECT_JOUEUR } },
  });
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

/**
 * Modification / retrait manuel (R4, R5, admins — droits vérifiés par la route). joueurId null = retirer.
 * `origine` ({ objet, jour }) : on modifie une désignation existante en changeant son rôle ou sa date
 * (ex. VIP du 23/11 -> Conducteur du 23/11). La désignation d'origine est alors retirée dans la même opération,
 * au lieu de garder les deux.
 */
async function modifier({ objet, jourJ, joueurId, auteur, origine = null }) {
  if (!OBJETS_DESIGNATION.includes(objet)) throw new ErreurDesignation('Choisis Conducteur ou VIP.');
  if (!jour.estJour(jourJ)) throw new ErreurDesignation('Date invalide.');
  if (Math.abs(jour.ecartJours(jour.aujourdhui(), jourJ)) > 366) throw new ErreurDesignation('La date doit être à moins d\'un an d\'aujourd\'hui.');
  let cible = null;
  if (joueurId !== null && joueurId !== undefined && joueurId !== '') {
    cible = await prisma.joueur.findUnique({ where: { id: Number(joueurId) } });
    if (!cible || cible.supprimeLe) throw new ErreurDesignation('Joueur introuvable.', 404);
  }
  const deplacement = origine && OBJETS_DESIGNATION.includes(origine.objet) && jour.estJour(origine.jour)
    && (origine.objet !== objet || origine.jour !== jourJ)
    ? { objet: origine.objet, jour: origine.jour, joueurId: origine.joueurId ? Number(origine.joueurId) : null } : null;
  if (deplacement && !cible) throw new ErreurDesignation('Choisis la personne à désigner.');

  const maintenant = new Date(); // même horodatage pour les deux lignes d'un déplacement (l'historique les relie)
  const r = await prisma.$transaction(async (tx) => {
    // verrous toujours pris dans le même ordre (pas d'interblocage entre deux modifications croisées)
    const cles = [[objet, jourJ], ...(deplacement ? [[deplacement.objet, deplacement.jour]] : [])].sort((x, y) => `${x}`.localeCompare(`${y}`));
    for (const [o, j] of cles) await verrouiller(tx, o, j);
    const actuelle = await tx.designation.findFirst({ where: { objet, jour: jour.versDate(jourJ), active: true }, include: { joueur: { select: SELECT_JOUEUR } } });
    if (!deplacement && (actuelle?.joueurId ?? null) === (cible?.id ?? null)) {
      throw new ErreurDesignation(cible ? `${cible.pseudo} est déjà désigné(e) pour ce jour.` : 'Personne n\'est désigné pour ce jour.');
    }
    let retiree = null;
    if (deplacement) {
      const ancienne = await tx.designation.findFirst({
        where: { objet: deplacement.objet, jour: jour.versDate(deplacement.jour), active: true }, include: { joueur: { select: SELECT_JOUEUR } },
      });
      // on ne retire l'ancienne désignation que si elle n'a pas changé entre-temps (toujours la personne modifiée)
      if (ancienne?.joueurId && ancienne.joueurId === (deplacement.joueurId ?? cible.id)) {
        retiree = await remplacer({ objet: deplacement.objet, jourJ: deplacement.jour, joueurId: null, mode: 'MANUELLE', auteurId: auteur.id, maintenant }, tx);
      }
    }
    const res = (actuelle?.joueurId ?? null) === cible.id && deplacement
      ? { avant: null, apres: actuelle, inchange: true }
      : await remplacer({ objet, jourJ, joueurId: cible?.id ?? null, mode: 'MANUELLE', auteurId: auteur.id, maintenant }, tx);
    return { ...res, retiree };
  });
  const nomRole = (o, j) => `${LIBELLES[o]} du ${j.slice(8, 10)}/${j.slice(5, 7)}`;
  if (r.retiree) {
    await journaliser(auteur.id, 'designation_deplacee', {
      joueur: cible.pseudo, ancien: nomAffiche(r.retiree.avant?.joueur), de: nomRole(deplacement.objet, deplacement.jour), vers: nomRole(objet, jourJ),
      remplace: r.avant?.joueur ? nomAffiche(r.avant.joueur) : 'Non désigné',
    });
  } else {
    await journaliser(auteur.id, cible ? 'designation_modifiee' : 'designation_retiree', {
      role: LIBELLES[objet], jour: jourJ, ancien: r.avant?.joueur ? nomAffiche(r.avant.joueur) : 'Non désigné', nouveau: cible ? cible.pseudo : 'Non désigné',
    });
  }
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

  // Déplacement (ex. VIP -> Conducteur) : deux lignes MANUELLE du même auteur au même instant,
  // l'une retire la personne (joueur vide, ancienPseudo = elle), l'autre la désigne ailleurs.
  const deplacements = new Map(); // id de ligne -> { objet, jour } de l'autre côté
  for (const l of lignes) {
    if (l.mode !== 'MANUELLE' || l.joueurId !== null || !l.ancienPseudo) continue;
    const autre = lignes.find((x) => x.id !== l.id && x.mode === 'MANUELLE' && x.auteurId === l.auteurId
      && +x.creeLe === +l.creeLe && x.joueur && (x.joueur.pseudoSupprime || x.joueur.pseudo) === l.ancienPseudo);
    if (autre) {
      deplacements.set(l.id, { sens: 'vers', objet: autre.objet, jour: jour.depuisDate(autre.jour) });
      deplacements.set(autre.id, { sens: 'depuis', objet: l.objet, jour: jour.depuisDate(l.jour) });
    }
  }
  const vers = (l) => {
    const r = remplacante.get(l.id);
    let statut = l.active ? 'en_vigueur' : 'remplace';
    let modifiePar = null;
    if (!l.active && r && r.mode === 'MANUELLE') { statut = 'modifie'; modifiePar = auteurDe[r.auteurId] || null; }
    return {
      id: l.id, objet: l.objet, jour: jour.depuisDate(l.jour), mode: l.mode, active: l.active,
      joueur: joueurPublic(l.joueur), ancienPseudo: l.ancienPseudo, auteur: auteurDe[l.auteurId] || null,
      date: l.creeLe, remplaceeLe: l.remplaceeLe, statut, modifiePar, jeu: jeu(l.partieId),
      deplacement: deplacements.get(l.id) || null,
    };
  };
  return {
    aujourdhui: auj,
    // un retrait à la main (ou un déplacement) ne laisse pas de case « Non désigné » dans les désignations à venir
    aVenir: aVenir.filter((l) => l.joueurId !== null || l.mode !== 'MANUELLE').map((l) => ({ ...vers(l), statut: 'en_vigueur' })),
    journal: lignes.map(vers),
  };
}

module.exports = {
  OBJETS_DESIGNATION, ErreurDesignation, nomAffiche, joueurPublic, SELECT_JOUEUR,
  attribuerGagnant, modifier, retirerCompteSupprime, duJour, historique,
};
