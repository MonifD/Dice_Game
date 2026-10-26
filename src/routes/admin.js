/** Routes /api/admin : comptes, rangs, rôles, questions du quiz, journaux. */
const express = require('express');
const prisma = require('../db/prisma');
const perms = require('../services/permissions');
const { profilPublic } = require('../services/authService');
const { journaliser } = require('../services/journal');
const { exigerConnexion, exigerAdmin, exigerSuperAdmin } = require('../middleware/auth');

const RANGS = ['R1', 'R2', 'R3', 'R4', 'R5'];

/** @param {() => import('socket.io').Server} obtenirIo pour déconnecter un compte bloqué en direct */
module.exports = function routesAdmin(obtenirIo) {
  const router = express.Router();
  router.use(exigerConnexion, exigerAdmin);

  async function chargerCible(req, res) {
    const cible = await prisma.joueur.findUnique({ where: { id: Number(req.params.id) } });
    if (!cible) { res.status(404).json({ erreur: 'Joueur introuvable.' }); return null; }
    if (!perms.peutModifierCompte(req.joueur, cible)) { res.status(403).json({ erreur: 'Tu ne peux pas modifier ce compte.' }); return null; }
    return cible;
  }
  const deconnecter = (id) => obtenirIo()?.in(`joueur:${id}`).disconnectSockets(true);

  // ---------------- comptes

  router.get('/joueurs', async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const joueurs = await prisma.joueur.findMany({
        where: q ? { pseudoNormalise: { contains: q } } : {},
        orderBy: [{ rang: 'desc' }, { pseudo: 'asc' }], take: 500,
        include: { _count: { select: { partiesGagnees: true, participations: true } } },
      });
      res.json({
        joueurs: joueurs.map((j) => ({
          ...profilPublic(j), derniereConnexion: j.derniereConnexion,
          victoires: j._count.partiesGagnees, parties: j._count.participations,
          modifiable: perms.peutModifierCompte(req.joueur, j),
        })),
      });
    } catch (e) { next(e); }
  });

  router.patch('/joueurs/:id/rang', async (req, res, next) => {
    try {
      const cible = await chargerCible(req, res); if (!cible) return;
      const rang = String(req.body?.rang);
      if (!RANGS.includes(rang)) return res.status(400).json({ erreur: 'Rang invalide.' });
      const j = await prisma.joueur.update({ where: { id: cible.id }, data: { rang } });
      await journaliser(req.joueur.id, 'rang', { joueur: cible.pseudo, de: cible.rang, a: rang });
      res.json({ joueur: profilPublic(j) });
    } catch (e) { next(e); }
  });

  router.patch('/joueurs/:id/actif', async (req, res, next) => {
    try {
      const cible = await chargerCible(req, res); if (!cible) return;
      const actif = !!req.body?.actif;
      const j = await prisma.joueur.update({ where: { id: cible.id }, data: { actif } });
      if (!actif) deconnecter(cible.id);
      await journaliser(req.joueur.id, actif ? 'debloquer' : 'bloquer', { joueur: cible.pseudo });
      res.json({ joueur: profilPublic(j) });
    } catch (e) { next(e); }
  });

  /** Réinitialiser le mot de passe d'un joueur qui l'a oublié. */
  router.post('/joueurs/:id/mot-de-passe', async (req, res, next) => {
    try {
      const cible = await chargerCible(req, res); if (!cible) return;
      const bcrypt = require('bcryptjs');
      const { validerMotDePasse, COUT_BCRYPT } = require('../services/authService');
      validerMotDePasse(req.body?.motDePasse);
      await prisma.joueur.update({ where: { id: cible.id }, data: { motDePasseHash: await bcrypt.hash(req.body.motDePasse, COUT_BCRYPT) } });
      deconnecter(cible.id);
      await journaliser(req.joueur.id, 'reinitialiser_mdp', { joueur: cible.pseudo });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.delete('/joueurs/:id', async (req, res, next) => {
    try {
      const cible = await chargerCible(req, res); if (!cible) return;
      // Les parties organisées/gagnées gardent une trace : on anonymise plutôt que de casser l'historique.
      const aDesParties = await prisma.partie.count({ where: { OR: [{ organisateurId: cible.id }, { gagnantId: cible.id }] } });
      if (aDesParties) {
        await prisma.joueur.update({
          where: { id: cible.id },
          data: { actif: false, pseudo: `[supprimé #${cible.id}]`, pseudoNormalise: `[supprime-${cible.id}]`, motDePasseHash: '!' },
        });
      } else {
        await prisma.joueur.delete({ where: { id: cible.id } });
      }
      deconnecter(cible.id);
      await journaliser(req.joueur.id, 'supprimer', { joueur: cible.pseudo });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /** Nommer / retirer un admin : super admin uniquement. */
  router.patch('/joueurs/:id/role', exigerSuperAdmin, async (req, res, next) => {
    try {
      const cible = await chargerCible(req, res); if (!cible) return;
      const role = String(req.body?.role);
      if (!['JOUEUR', 'ADMIN'].includes(role)) return res.status(400).json({ erreur: 'Rôle invalide.' });
      const j = await prisma.joueur.update({ where: { id: cible.id }, data: { role } });
      await journaliser(req.joueur.id, 'role', { joueur: cible.pseudo, de: cible.role, a: role });
      res.json({ joueur: profilPublic(j) });
    } catch (e) { next(e); }
  });

  // ---------------- questions du quiz

  function validerQuestion(b) {
    const question = String(b?.question || '').trim();
    const choix = (Array.isArray(b?.choix) ? b.choix : []).map((c) => String(c).trim()).filter(Boolean);
    const bonneReponse = Number(b?.bonneReponse);
    if (question.length < 3 || question.length > 300) throw Object.assign(new Error('Question : 3 à 300 caractères.'), { statut: 400 });
    if (choix.length < 2 || choix.length > 4) throw Object.assign(new Error('Il faut 2 à 4 réponses.'), { statut: 400 });
    if (!Number.isInteger(bonneReponse) || bonneReponse < 0 || bonneReponse >= choix.length) throw Object.assign(new Error('Bonne réponse invalide.'), { statut: 400 });
    return { question, choix, bonneReponse, categorie: String(b?.categorie || 'Last War').slice(0, 40), active: b?.active !== false };
  }

  router.get('/questions', async (req, res, next) => {
    try { res.json({ questions: await prisma.questionQuiz.findMany({ orderBy: { id: 'desc' } }) }); } catch (e) { next(e); }
  });
  router.post('/questions', async (req, res, next) => {
    try { res.status(201).json({ question: await prisma.questionQuiz.create({ data: validerQuestion(req.body) }) }); } catch (e) { next(e); }
  });
  router.put('/questions/:id', async (req, res, next) => {
    try { res.json({ question: await prisma.questionQuiz.update({ where: { id: Number(req.params.id) }, data: validerQuestion(req.body) }) }); } catch (e) { next(e); }
  });
  router.delete('/questions/:id', async (req, res, next) => {
    try { await prisma.questionQuiz.delete({ where: { id: Number(req.params.id) } }); res.json({ ok: true }); } catch (e) { next(e); }
  });

  // ---------------- journaux (super admin)

  router.get('/journaux', exigerSuperAdmin, async (req, res, next) => {
    try {
      const journaux = await prisma.journal.findMany({ orderBy: { date: 'desc' }, take: 300 });
      const auteurs = await prisma.joueur.findMany({
        where: { id: { in: [...new Set(journaux.map((j) => j.auteurId).filter(Boolean))] } }, select: { id: true, pseudo: true },
      });
      const nom = Object.fromEntries(auteurs.map((a) => [a.id, a.pseudo]));
      res.json({ journaux: journaux.map((j) => ({ ...j, auteur: nom[j.auteurId] || null })) });
    } catch (e) { next(e); }
  });

  return router;
};
