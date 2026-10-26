/** Routes /api : salles, catalogue des mini-jeux, historique, classement, profil joueur. */
const express = require('express');
const prisma = require('../db/prisma');
const moteur = require('../moteur/moteur');
const registre = require('../minijeux');
const { exigerConnexion, exigerOrganisateur } = require('../middleware/auth');

const router = express.Router();
router.use(exigerConnexion);

/** Liste des mini-jeux et de leurs paramètres (formulaire de création). */
router.get('/minijeux', (req, res) => res.json({ minijeux: registre.catalogue() }));

/** Salles en attente ou en cours. */
router.get('/salles', async (req, res, next) => {
  try { res.json({ salles: await moteur.listerSalles() }); } catch (e) { next(e); }
});

/** Créer une salle (R4, R5, admins). */
router.post('/salles', exigerOrganisateur, async (req, res, next) => {
  try {
    const etat = await moteur.creerSalle({
      organisateurId: req.joueur.id, miniJeuId: req.body?.miniJeu, parametres: req.body?.parametres || {}, objet: req.body?.objet, dateObjet: req.body?.dateObjet,
    });
    res.status(201).json({ code: etat.code });
  } catch (e) { next(e); }
});

const jour = (d) => (d ? d.toISOString().slice(0, 10) : null); // colonne DATE -> « AAAA-MM-JJ »

/**
 * Désignations en cours, pour chaque objet (Conducteur, VIP) : celle d'aujourd'hui,
 * sinon la prochaine à venir, sinon la dernière passée.
 */
router.get('/designations', async (req, res, next) => {
  try {
    const auj = new Date(`${moteur.aujourdhui()}T00:00:00Z`);
    const select = { dateObjet: true, miniJeu: true, gagnant: { select: { id: true, pseudo: true } } };
    const base = { statut: 'TERMINEE', gagnantId: { not: null }, dateObjet: { not: null } };
    const dernieres = await Promise.all(moteur.OBJETS.map(async (objet) => (
      await prisma.partie.findFirst({ where: { ...base, objet, dateObjet: { gte: auj } }, orderBy: [{ dateObjet: 'asc' }, { dateFin: 'desc' }], select })
      || prisma.partie.findFirst({ where: { ...base, objet }, orderBy: [{ dateObjet: 'desc' }, { dateFin: 'desc' }], select })
    )));
    res.json({
      aujourdhui: moteur.aujourdhui(),
      designations: Object.fromEntries(moteur.OBJETS.map((objet, i) => [objet, dernieres[i] ? {
        gagnant: dernieres[i].gagnant, dateObjet: jour(dernieres[i].dateObjet),
        miniJeu: registre.obtenir(dernieres[i].miniJeu)?.nom || dernieres[i].miniJeu,
        icone: registre.obtenir(dernieres[i].miniJeu)?.icone || '🎮',
      } : null])),
    });
  } catch (e) { next(e); }
});

/** Historique : parties terminées (date, objet, mini-jeu, gagnant), paginé, filtrable par objet. */
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
        include: { gagnant: { select: { id: true, pseudo: true } }, organisateur: { select: { pseudo: true } } },
      }),
    ]);
    res.json({
      total, page, parPage,
      parties: parties.map((p) => ({
        id: p.id, code: p.code, date: p.dateDebut || p.dateCreation, statut: p.statut, objet: p.objet, dateObjet: jour(p.dateObjet),
        miniJeu: registre.obtenir(p.miniJeu)?.nom || p.miniJeu, icone: registre.obtenir(p.miniJeu)?.icone || '🎮',
        nbParticipants: p.nbParticipants, nbTours: p.nbTours, gagnant: p.gagnant, organisateur: p.organisateur.pseudo,
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
      where: { id: { in: victoires.map((v) => v.gagnantId) } }, select: { id: true, pseudo: true, rang: true },
    });
    const parId = Object.fromEntries(joueurs.map((j) => [j.id, j]));
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
