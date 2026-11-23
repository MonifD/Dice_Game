/** Routes /api : salles, catalogue des mini-jeux, historique, classement, profil joueur. */
const express = require('express');
const prisma = require('../db/prisma');
const moteur = require('../moteur/moteur');
const registre = require('../minijeux');
const designations = require('../services/designations');
const { nomAffiche, joueurPublic, SELECT_JOUEUR } = designations;
const { exigerConnexion, exigerOrganisateur } = require('../middleware/auth');

const router = express.Router();
router.use(exigerConnexion);

/** Liste des mini-jeux et de leurs paramètres (formulaire de création). */
router.get('/minijeux', (req, res) => res.json({ minijeux: registre.catalogue(), ...registre.categories() }));

/** Salles en attente ou en cours. */
router.get('/salles', async (req, res, next) => {
  try { res.json({ salles: await moteur.listerSalles() }); } catch (e) { next(e); }
});

/**
 * Créer une salle : tout membre connecté en « Pour s'amuser » ; Conducteur / VIP réservés aux R4, R5 et admins
 * (vérifié par le moteur, même si le navigateur n'a pas proposé ces options).
 */
router.post('/salles', async (req, res, next) => {
  try {
    const etat = await moteur.creerSalle({
      organisateurId: req.joueur.id, miniJeuId: req.body?.miniJeu, parametres: req.body?.parametres || {}, objet: req.body?.objet, dateObjet: req.body?.dateObjet,
    });
    res.status(201).json({ code: etat.code });
  } catch (e) { next(e); }
});

const jour = (d) => (d ? d.toISOString().slice(0, 10) : null); // colonne DATE -> « AAAA-MM-JJ »

/** Bandeaux de l'accueil : Conducteur et VIP désignés pour le jour en cours (règle des 3h du matin). */
router.get('/designations', async (req, res, next) => {
  try {
    res.json({ aujourdhui: moteur.aujourdhui(), designations: await designations.duJour(moteur.aujourdhui(), registre) });
  } catch (e) { next(e); }
});

/** Désignations à venir + journal des désignations (remplacées, modifiées, retirées). */
router.get('/designations/historique', async (req, res, next) => {
  try { res.json(await designations.historique({ registre })); } catch (e) { next(e); }
});

/** Modifier ou retirer à la main le Conducteur / VIP d'une date (R4, R5, admins). joueurId: null = retirer. */
router.put('/designations', exigerOrganisateur, async (req, res, next) => {
  try {
    const { objet, jour: jourJ, joueurId = null } = req.body || {};
    const d = await designations.modifier({ objet, jourJ, joueurId, auteur: req.joueur });
    res.json({ designation: { objet: d.objet, jour: jour(d.jour), joueur: joueurPublic(d.joueur) } });
  } catch (e) { next(e); }
});

/** Liste des membres (choix d'un Conducteur / VIP à la main) : R4, R5, admins. */
router.get('/membres', exigerOrganisateur, async (req, res, next) => {
  try {
    const membres = await prisma.joueur.findMany({
      where: { supprimeLe: null, actif: true }, orderBy: { pseudoNormalise: 'asc' }, select: { id: true, pseudo: true, rang: true }, take: 1000,
    });
    res.json({ membres });
  } catch (e) { next(e); }
});

/** Historique : parties terminées (date, objet, jour J, mini-jeu, gagnant), paginé, filtrable par objet. */
router.get('/historique', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const parPage = 25;
    const where = { statut: { in: ['TERMINEE', 'ANNULEE'] } };
    if (moteur.OBJETS.includes(req.query.objet)) where.objet = req.query.objet;
    const [total, parties] = await Promise.all([
      prisma.partie.count({ where }),
      prisma.partie.findMany({
        where, orderBy: { dateCreation: 'desc' }, skip: (page - 1) * parPage, take: parPage,
        include: { gagnant: { select: SELECT_JOUEUR }, organisateur: { select: SELECT_JOUEUR } },
      }),
    ]);
    res.json({
      total, page, parPage,
      parties: parties.map((p) => ({
        id: p.id, code: p.code, date: p.dateDebut || p.dateCreation, statut: p.statut, objet: p.objet, dateObjet: jour(p.dateObjet),
        miniJeu: registre.obtenir(p.miniJeu)?.nom || p.miniJeu, icone: registre.obtenir(p.miniJeu)?.icone || '🎮',
        nbParticipants: p.nbParticipants, nbTours: p.nbTours, gagnant: joueurPublic(p.gagnant), organisateur: nomAffiche(p.organisateur),
      })),
    });
  } catch (e) { next(e); }
});

/** Classement par nombre de victoires. */
router.get('/classement', async (req, res, next) => {
  try {
    const victoires = await prisma.partie.groupBy({
      by: ['gagnantId'], where: { statut: 'TERMINEE', gagnantId: { not: null } },
      _count: { _all: true }, orderBy: { _count: { gagnantId: 'desc' } }, take: 100,
    });
    const participations = await prisma.participation.groupBy({
      by: ['joueurId'], where: { joueurId: { in: victoires.map((v) => v.gagnantId) }, partie: { statut: 'TERMINEE' } },
      _count: { _all: true },
    });
    const joueurs = await prisma.joueur.findMany({
      where: { id: { in: victoires.map((v) => v.gagnantId) } }, select: { ...SELECT_JOUEUR, rang: true },
    });
    const parId = Object.fromEntries(joueurs.map((j) => [j.id, { ...joueurPublic(j), rang: j.supprimeLe ? null : j.rang }]));
    const nbParties = Object.fromEntries(participations.map((p) => [p.joueurId, p._count._all]));
    res.json({
      classement: victoires.map((v, i) => ({
        rang: i + 1, joueur: parId[v.gagnantId], victoires: v._count._all, parties: nbParties[v.gagnantId] || 0,
      })),
    });
  } catch (e) { next(e); }
});

/** Mes statistiques (page d'accueil). */
router.get('/moi/stats', async (req, res, next) => {
  try {
    const [victoires, parties, dernieres] = await Promise.all([
      prisma.partie.count({ where: { gagnantId: req.joueur.id, statut: 'TERMINEE' } }),
      prisma.participation.count({ where: { joueurId: req.joueur.id, partie: { statut: 'TERMINEE' } } }),
      prisma.partie.findMany({
        where: { gagnantId: req.joueur.id, statut: 'TERMINEE' }, orderBy: { dateFin: 'desc' }, take: 10,
        select: { id: true, miniJeu: true, objet: true, dateObjet: true, dateFin: true, nbParticipants: true },
      }),
    ]);
    res.json({
      victoires, parties,
      dernieresVictoires: dernieres.map((p) => ({ ...p, dateObjet: jour(p.dateObjet), miniJeu: registre.obtenir(p.miniJeu)?.nom || p.miniJeu })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
