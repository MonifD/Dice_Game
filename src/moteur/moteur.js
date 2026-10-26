/**
 * MOTEUR DE PARTIE — commun à tous les mini-jeux.
 *
 * Il gère : salles, salle d'attente, tours, chronomètre, éliminations (y compris
 * des absents), spectateurs, rejeu si tout le monde est éliminé, départage
 * (mort subite), fin de partie et enregistrement en base.
 *
 * Il ne connaît RIEN des règles d'un mini-jeu : il appelle l'interface du module
 * (voir src/minijeux/index.js).
 *
 * État et multi-instances
 * -----------------------
 * Tout l'état est dans le stockage partagé (Redis), jamais seulement en mémoire :
 *   salle:<code>                         état JSON de la salle
 *   salle:<code>:a:<tour>:<essai>        hash joueurId -> action du tour
 *   salle:<code>:a:<tour>:<essai>:n      compteur de joueurs ayant fini leur tour
 *   salles:actives                       ensemble des salles non terminées
 * Les transitions (fin de tour, tour suivant) se font sous verrou : une seule
 * instance les exécute. Chaque instance scrute les échéances toutes les secondes,
 * donc si l'instance qui a lancé un tour disparaît, une autre prend le relais.
 */
const prisma = require('../db/prisma');
const { stockage, avecVerrou } = require('../db/stockage');
const config = require('../config');
const registre = require('../minijeux');
const departage = require('./departage');
const { validerParametres } = require('./parametres');
const { ErreurJeu, rng } = require('./outils');
const perms = require('../services/permissions');

const GRACE_MS = 600; // tolérance réseau après la fin du chrono
const DELAI_DERNIER_COUP_MS = 2000; // quand tout le monde a joué : on laisse voir le dernier coup (ex. dé qui roule) avant les résultats
const MAX_REJEUX = 5; // au 5e rejeu consécutif d'un même tour, on passe en mort subite
const TTL_ACTIONS_S = 6 * 3600;
const TTL_SALLE_TERMINEE_S = 12 * 3600;
const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const OBJETS = ['CONDUCTEUR', 'VIP']; // objet de la partie : ce que le gagnant obtient

/** Date du jour à Paris, au format AAAA-MM-JJ. */
const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

/** Vérifie la date d'application (« AAAA-MM-JJ », entre 7 jours avant et 1 an après aujourd'hui). */
function validerDateObjet(d) {
  const s = String(d || '');
  const date = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== s) {
    throw new ErreurJeu('Choisis la date à laquelle le gagnant sera Conducteur ou VIP.');
  }
  const ecartJours = (date - new Date(`${aujourdhui()}T00:00:00Z`)) / 86400000;
  if (ecartJours < -7 || ecartJours > 366) throw new ErreurJeu('La date du Conducteur / VIP doit être proche d\'aujourd\'hui.');
  return s;
}

const cleSalle = (code) => `salle:${code}`;
const cleActions = (code, tour, essai) => `salle:${code}:a:${tour}:${essai}`;
const cleVerrouSalle = (code) => `verrou:salle:${code}`;

class Moteur {
  constructor() {
    this.io = null;
    this.minuteurs = new Map(); // code -> timeout local (accélérateur ; la scrutation est le filet de sécurité)
    this.scrutationEnCours = false;
    this.cache = new Map(); // code -> { etat, t } : lecture rapide pour les actions très fréquentes (clics)
  }

  /** Branche Socket.IO et démarre la scrutation des échéances. */
  attacher(io) {
    this.io = io;
    this.intervalle = setInterval(() => this.scruter().catch((e) => console.error('[moteur] scrutation', e)), 1000);
    this.intervalle.unref?.();
  }

  arreterScrutation() { clearInterval(this.intervalle); for (const t of this.minuteurs.values()) clearTimeout(t); }

  // ------------------------------------------------------------------ utilitaires

  async lire(code) {
    const brut = await stockage.get(cleSalle(String(code).toUpperCase()));
    return brut ? JSON.parse(brut) : null;
  }

  async ecrire(etat) {
    this.cache.delete(etat.code);
    await stockage.set(cleSalle(etat.code), JSON.stringify(etat));
  }

  /** Lecture avec un cache local de 250 ms (seulement pour valider les actions des joueurs). */
  async lireRapide(code) {
    const c = this.cache.get(code);
    if (c && Date.now() - c.t < 250) return c.etat;
    const etat = await this.lire(code);
    if (etat) this.cache.set(code, { etat, t: Date.now() });
    if (this.cache.size > 200) this.cache.clear();
    return etat;
  }

  /** Module actif : le mini-jeu choisi, ou la mort subite si on est en départage. */
  module(etat) { return etat.departage ? departage : registre.obtenir(etat.miniJeu); }

  idsEnJeu(etat) { return etat.ordre.filter((id) => etat.joueurs[id]?.statut === 'enJeu'); }

  emettre(salle, evenement, donnees) { this.io?.to(salle).emit(evenement, donnees); }

  async exigerSalle(code) {
    const etat = await this.lire(code);
    if (!etat) throw new ErreurJeu('Salle introuvable.');
    return etat;
  }

  /** Vérifie les droits d'organisation avec les données FRAÎCHES de la base. */
  async exigerOrganisateur(auteurId) {
    const j = await prisma.joueur.findUnique({ where: { id: Number(auteurId) } });
    if (!perms.peutOrganiser(j)) throw new ErreurJeu('Seuls les R4, R5 et admins peuvent faire ça.');
    return j;
  }

  /** Exécute fn(etat) sous le verrou de la salle, puis sauvegarde/diffuse si demandé. */
  async sousVerrou(code, fn) {
    return avecVerrou(cleVerrouSalle(code), async () => {
      const etat = await this.exigerSalle(code);
      const r = await fn(etat);
      return r;
    }, { ttlMs: 15000, attenteMaxMs: 10000 });
  }

  async genererCode() {
    for (let i = 0; i < 20; i++) {
      let code = '';
      for (let k = 0; k < 6; k++) code += ALPHABET_CODE[rng.entier(0, ALPHABET_CODE.length - 1)];
      if (!(await stockage.get(cleSalle(code)))) return code;
    }
    throw new Error('Impossible de générer un code de salle.');
  }

  // ------------------------------------------------------------------ salles

  async creerSalle({ organisateurId, miniJeuId, parametres, objet, dateObjet }) {
    const org = await this.exigerOrganisateur(organisateurId);
    const mod = registre.obtenir(miniJeuId);
    if (!mod) throw new ErreurJeu('Mini-jeu inconnu.');
    if (!OBJETS.includes(objet)) throw new ErreurJeu('Précise l\'objet de la partie : Conducteur ou VIP du train.');
    dateObjet = validerDateObjet(dateObjet);
    const params = validerParametres(mod, parametres);
    const code = await this.genererCode();

    const partie = await prisma.partie.create({
      data: { code, miniJeu: mod.id, objet, dateObjet: new Date(`${dateObjet}T00:00:00Z`), parametres: params, organisateurId: org.id },
    });

    const etat = {
      code, partieId: partie.id, miniJeu: mod.id, objet, dateObjet, params,
      organisateur: { id: String(org.id), pseudo: org.pseudo },
      phase: 'attente', creeLe: Date.now(), debutLe: null, finLe: null,
      joueurs: {}, ordre: [],
      tour: 0, essai: 0, departage: false, departageAVenir: false,
      etatJeu: null, tourCourant: null, dernierResultat: null, echeance: null,
      gagnant: null, gagnantAVenir: null, annulee: false, reglagesOrga: null,
    };
    await this.ecrire(etat);
    await stockage.sadd('salles:actives', code);
    this.emettre('accueil', 'salles:maj', {});
    return etat;
  }

  /** Inscription en salle d'attente (impossible une fois la partie lancée). */
  async inscrire(code, joueur) {
    const id = String(joueur.id);
    const r = await this.sousVerrou(code, async (etat) => {
      if (etat.joueurs[id]) return { deja: true };
      if (etat.phase !== 'attente') throw new ErreurJeu('La partie a déjà commencé : tu peux la suivre en spectateur.');
      if (etat.ordre.length >= config.maxJoueursParSalle) throw new ErreurJeu('La salle est pleine.');
      etat.joueurs[id] = { pseudo: joueur.pseudo, statut: 'enJeu', tourElimination: null, pret: false };
      etat.ordre.push(id);
      await this.ecrire(etat);
      return { nb: etat.ordre.length };
    });
    if (!r.deja) {
      this.emettre(`salle:${code}`, 'salle:inscription', { id, pseudo: joueur.pseudo, nb: r.nb });
      this.emettre('accueil', 'salles:maj', {});
    }
    return r;
  }

  /** Quitter la salle d'attente (ou en exclure quelqu'un de pas prêt, pour l'organisateur). */
  async desinscrire(code, joueurId, auteurId = joueurId) {
    const id = String(joueurId);
    if (String(auteurId) !== id) await this.exigerOrganisateur(auteurId);
    const nb = await this.sousVerrou(code, async (etat) => {
      if (etat.phase !== 'attente') throw new ErreurJeu('La partie a commencé : impossible de quitter la liste.');
      if (!etat.joueurs[id]) return null;
      if (String(auteurId) !== id && etat.joueurs[id].pret) throw new ErreurJeu(`${etat.joueurs[id].pseudo} est prêt : on ne peut exclure que les joueurs pas prêts.`);
      delete etat.joueurs[id];
      etat.ordre = etat.ordre.filter((x) => x !== id);
      await this.ecrire(etat);
      return etat.ordre.length;
    });
    if (nb !== null) {
      this.emettre(`salle:${code}`, 'salle:desinscription', { id, nb, exclu: String(auteurId) !== id });
      this.emettre('accueil', 'salles:maj', {});
    }
  }

  /** Un inscrit se déclare prêt (ou plus prêt) en salle d'attente. */
  async definirPret(code, joueurId, pret) {
    const id = String(joueurId);
    const r = await this.sousVerrou(code, async (etat) => {
      if (etat.phase !== 'attente') throw new ErreurJeu('La partie a déjà commencé.');
      if (!etat.joueurs[id]) throw new ErreurJeu('Inscris-toi d\'abord dans la salle.');
      etat.joueurs[id].pret = !!pret;
      await this.ecrire(etat);
      return { pret: !!pret, nbPrets: etat.ordre.filter((x) => etat.joueurs[x].pret).length, nb: etat.ordre.length };
    });
    this.emettre(`salle:${code}`, 'salle:pret', { id, ...r });
    return r;
  }

  /** L'organisateur fait sonner l'alerte chez tous les joueurs de la salle (une fois toutes les 10 s). */
  async alerter(code, auteurId) {
    const org = await this.exigerOrganisateur(auteurId);
    await this.sousVerrou(code, async (etat) => {
      if (etat.phase !== 'attente') throw new ErreurJeu('La partie a déjà commencé.');
      if (etat.derniereAlerte && Date.now() - etat.derniereAlerte < 10000) throw new ErreurJeu('Alerte déjà envoyée, patiente quelques secondes.');
      etat.derniereAlerte = Date.now();
      await this.ecrire(etat);
    });
    this.emettre(`salle:${code}`, 'salle:alerte', { par: org.pseudo });
  }

  async lancer(code, auteurId) {
    await this.exigerOrganisateur(auteurId);
    await this.sousVerrou(code, async (etat) => {
      if (etat.phase !== 'attente') throw new ErreurJeu('La partie est déjà lancée.');
      if (etat.ordre.length < 2) throw new ErreurJeu('Il faut au moins 2 joueurs inscrits.');
      const pasPrets = etat.ordre.filter((id) => !etat.joueurs[id].pret);
      if (pasPrets.length) {
        const noms = pasPrets.slice(0, 5).map((id) => etat.joueurs[id].pseudo).join(', ');
        throw new ErreurJeu(`${pasPrets.length} joueur(s) pas encore prêt(s) : ${noms}${pasPrets.length > 5 ? '…' : ''}`);
      }
      const mod = this.module(etat);
      const joueurs = etat.ordre.map((id) => ({ id, pseudo: etat.joueurs[id].pseudo }));
      etat.etatJeu = await mod.initialiser({ params: etat.params, joueurs, rng, outils: { prisma }, reglages: etat.reglagesOrga });
      etat.debutLe = Date.now();

      try {
        await prisma.partie.update({
          where: { id: etat.partieId },
          data: { statut: 'EN_COURS', dateDebut: new Date(), nbParticipants: etat.ordre.length },
        });
        await prisma.participation.createMany({
          data: etat.ordre.map((id) => ({ joueurId: Number(id), partieId: etat.partieId })),
          skipDuplicates: true,
        });
      } catch (e) { console.error('[moteur] enregistrement du lancement', e.message); }

      await this.demarrerTour(etat);
      await this.ecrire(etat);
      this.apresTransition(etat);
    });
  }

  /** Bouton « suivant » de l'organisateur : termine le tour en cours ou lance le suivant. */
  async suivant(code, auteurId) {
    await this.exigerOrganisateur(auteurId);
    await this.sousVerrou(code, async (etat) => {
      if (etat.phase === 'tour') await this.resoudreTour(etat);
      else if (etat.phase === 'resultats') await this.apresResultats(etat);
      else throw new ErreurJeu('Rien à faire passer maintenant.');
      await this.ecrire(etat);
      this.apresTransition(etat);
    });
  }

  /** Numéro du prochain tour (le même si le tour est rejoué). */
  prochainTour(etat) {
    if (etat.phase === 'attente') return 1;
    return etat.dernierResultat?.rejoue ? etat.tour : etat.tour + 1;
  }

  /**
   * Réglage du mini-jeu par l'organisateur pour le prochain tour (ex. options A / B de « La minorité »),
   * en salle d'attente ou sur l'écran des résultats. Le module valide via commandeOrganisateur().
   */
  async commandeOrga(code, auteurId, donnees) {
    await this.exigerOrganisateur(auteurId);
    await this.sousVerrou(code, async (etat) => {
      const mod = registre.obtenir(etat.miniJeu);
      if (typeof mod.commandeOrganisateur !== 'function') throw new ErreurJeu('Ce mini-jeu n\'a pas de réglage en cours de partie.');
      if (!['attente', 'resultats'].includes(etat.phase) || etat.departage || etat.departageAVenir || etat.gagnantAVenir) {
        throw new ErreurJeu('On ne peut changer ce réglage qu\'en salle d\'attente ou entre deux tours.');
      }
      etat.reglagesOrga = mod.commandeOrganisateur({ donnees, params: etat.params, prochainTour: this.prochainTour(etat) });
      // fin de la pause « réglage » : le tour suivant repart 3 s après l'enregistrement
      if (etat.pauseReglage) {
        etat.pauseReglage = false;
        if (etat.params.avanceAuto && etat.phase === 'resultats') etat.echeance = Date.now() + 3000;
      }
      await this.ecrire(etat);
      this.apresTransition(etat);
    });
  }

  /** L'organisateur commence à modifier un réglage entre deux tours : on suspend le compte à rebours. */
  async pauseReglage(code, auteurId) {
    await this.exigerOrganisateur(auteurId);
    await this.sousVerrou(code, async (etat) => {
      if (etat.phase !== 'resultats' || etat.pauseReglage || !etat.echeance || etat.gagnantAVenir) return;
      etat.pauseReglage = true;
      etat.echeance = null;
      await this.ecrire(etat);
      this.apresTransition(etat);
    });
  }

  async arreter(code, auteurId) {
    await this.exigerOrganisateur(auteurId);
    await this.sousVerrou(code, async (etat) => {
      if (etat.phase === 'termine') return;
      etat.phase = 'termine';
      etat.annulee = true;
      etat.finLe = Date.now();
      etat.echeance = null;
      etat.tourCourant = null;
      await this.ecrire(etat);
      await this.archiver(etat);
      try {
        await prisma.partie.update({ where: { id: etat.partieId }, data: { statut: 'ANNULEE', dateFin: new Date(), nbTours: etat.tour } });
      } catch (e) { console.error('[moteur] annulation', e.message); }
      this.apresTransition(etat);
    });
  }

  // ------------------------------------------------------------------ actions des joueurs

  /**
   * Action d'un joueur pendant un tour. Pas de verrou de salle ici (100 joueurs
   * jouent en même temps) : chaque action est stockée dans le hash du tour sous
   * un petit verrou propre au joueur. Le module ne modifie jamais l'état global
   * dans action() ; il ne le fait que dans resoudreTour(), sous verrou de salle.
   */
  async agir(code, joueurId, donnees) {
    const id = String(joueurId);
    let etat = await this.lireRapide(code);
    if (!etat) throw new ErreurJeu('Salle introuvable.');
    // le cache peut avoir quelques ms de retard au tout début d'un tour : on relit
    if (etat.phase !== 'tour' || Date.now() > etat.tourCourant.finMs) { this.cache.delete(code); etat = await this.exigerSalle(code); }
    if (etat.phase !== 'tour') throw new ErreurJeu('Aucun tour en cours.');
    const j = etat.joueurs[id];
    if (!j) throw new ErreurJeu('Tu ne participes pas à cette partie (spectateur).');
    if (j.statut !== 'enJeu') throw new ErreurJeu('Tu es éliminé : tu ne peux plus jouer.');
    const mod = this.module(etat);
    if (mod.actionRequise === false) throw new ErreurJeu('Aucune action à faire dans ce tour.');
    const tc = etat.tourCourant;
    const maintenant = Date.now();
    if (maintenant > tc.finMs + GRACE_MS) throw new ErreurJeu('Temps écoulé !');

    const cle = cleActions(code, tc.numero, tc.essai);
    const res = await avecVerrou(`verrou:salle:${code}:j:${id}`, async () => {
      const precedent = JSON.parse((await stockage.hget(cle, id)) || 'null');
      if (precedent?.f) throw new ErreurJeu('Tu as déjà joué ce tour.');
      const r = await mod.action({
        etat: etat.etatJeu, joueurId: id, donnees: donnees ?? {}, precedent: precedent?.d,
        ecouleMs: maintenant - tc.debutMs, params: etat.params, rng, tour: tc.numero,
      });
      const fini = r.fini !== false;
      await stockage.hset(cle, id, JSON.stringify({ d: r.enregistrer ?? null, f: fini, p: r.public ?? null }));
      await stockage.expire(cle, TTL_ACTIONS_S);
      let nbFinis = null;
      if (fini) {
        nbFinis = await stockage.incr(`${cle}:n`);
        await stockage.expire(`${cle}:n`, TTL_ACTIONS_S);
        await stockage.set(`${cle}:t`, String(Date.now()));
        await stockage.expire(`${cle}:t`, TTL_ACTIONS_S);
      }
      return { ...r, fini, nbFinis };
    }, { ttlMs: 3000, attenteMaxMs: 3000 });

    if (res.fini || res.public != null) {
      this.emettre(`salle:${code}`, 'jeu:aAgi', {
        tour: tc.numero, essai: tc.essai, joueurId: id, pseudo: j.pseudo, fini: res.fini, public: res.public ?? null,
      });
    }
    // Tout le monde a joué : on termine le tour sans attendre le chrono (après avoir laissé voir le dernier coup).
    if (res.fini && res.nbFinis >= this.idsEnJeu(etat).length) {
      setTimeout(() => this.traiter(code).catch((e) => console.error('[moteur] fin anticipée', e)), DELAI_DERNIER_COUP_MS + 50).unref?.();
    }
    return { prive: res.prive ?? null, fini: res.fini, public: res.public ?? null };
  }

  // ------------------------------------------------------------------ transitions (sous verrou)

  async demarrerTour(etat) {
    let nouveauTour = !etat.dernierResultat?.rejoue;
    if (etat.departageAVenir) {
      etat.departage = true;
      etat.departageAVenir = false;
      etat.etatJeu = await departage.initialiser();
      nouveauTour = true;
    }
    if (!nouveauTour) etat.essai += 1;
    else { etat.tour += 1; etat.essai = 0; }
    etat.dernierResultat = etat.dernierResultat ? { ...etat.dernierResultat, rejoue: false } : null;

    const mod = this.module(etat);
    const enJeu = this.idsEnJeu(etat);
    const r = (await mod.debutTour({
      etat: etat.etatJeu, tour: etat.tour, essai: etat.essai, enJeu, params: etat.params, rng, reglages: etat.reglagesOrga,
    })) || {};
    if (r.etat !== undefined) etat.etatJeu = r.etat;

    const debutMs = Date.now();
    const dureeMs = r.dureeMs ?? etat.params.dureeTour * 1000;
    etat.tourCourant = {
      numero: etat.tour, essai: etat.essai, debutMs, finMs: debutMs + dureeMs,
      public: r.public ?? null, evenements: r.evenements || [],
    };
    etat.phase = 'tour';
    etat.echeance = etat.tourCourant.finMs + GRACE_MS;
    this.programmerEvenements(etat);
  }

  /** Émet les événements programmés du tour (ex. « feu vert ») au bon moment. */
  programmerEvenements(etat) {
    const { code } = etat;
    const tc = etat.tourCourant;
    for (const ev of tc.evenements) {
      setTimeout(() => {
        this.emettre(`salle:${code}`, 'jeu:evenement', { tour: tc.numero, essai: tc.essai, type: ev.type, donnees: ev.donnees ?? null });
      }, Math.max(0, tc.debutMs + ev.dansMs - Date.now())).unref?.();
    }
  }

  async resoudreTour(etat) {
    const mod = this.module(etat);
    const tc = etat.tourCourant;
    const enJeu = this.idsEnJeu(etat);
    const brut = await stockage.hgetall(cleActions(etat.code, tc.numero, tc.essai));
    const actions = {};
    for (const id of enJeu) if (brut[id]) actions[id] = JSON.parse(brut[id]).d;
    const actionRequise = mod.actionRequise !== false;
    const absents = actionRequise ? enJeu.filter((id) => !(id in actions)) : [];

    let res = { survivants: [], details: null, etat: etat.etatJeu };
    if (!actionRequise || Object.keys(actions).length) {
      res = await mod.resoudreTour({ etat: etat.etatJeu, actions, enJeu, params: etat.params, rng, tour: tc.numero });
    }
    // Sécurité : un survivant doit être en jeu et (si une action est requise) avoir joué.
    let survivants = [...new Set((res.survivants || []).map(String))]
      .filter((id) => enJeu.includes(id) && (!actionRequise || id in actions));
    const ontJoue = enJeu.filter((id) => !absents.includes(id));
    let message = res.message || null;

    // Personne parmi ceux qui ont joué ne survit :
    //  - personne n'a joué du tout          -> tour rejoué entre tous (sinon il ne resterait personne) ;
    //  - un seul joueur a joué              -> il passe (les absents sont éliminés) ;
    //  - plusieurs ont joué                 -> tour rejoué entre EUX ; les absents sont quand même éliminés.
    if (survivants.length === 0 && ontJoue.length === 1) {
      survivants = ontJoue;
      message = `${message ? message + ' ' : ''}${etat.joueurs[ontJoue[0]].pseudo} est le seul à avoir joué : il passe.`;
    }
    const rejoue = survivants.length === 0;
    const elimines = rejoue ? (ontJoue.length ? absents : []) : enJeu.filter((id) => !survivants.includes(id));
    if (!rejoue) etat.etatJeu = res.etat ?? etat.etatJeu; // en cas de rejeu, on garde l'état d'avant le tour
    for (const id of elimines) {
      etat.joueurs[id].statut = 'elimine';
      etat.joueurs[id].tourElimination = tc.numero;
    }

    if (rejoue) {
      message = `${res.message ? res.message + ' ' : ''}${!ontJoue.length
        ? 'Personne n\'a joué : le tour est rejoué.'
        : `Tous ceux qui ont joué seraient éliminés : le tour est rejoué entre eux.${absents.length ? ` ${absents.length > 1 ? 'Les absents sont éliminés' : 'L\'absent est éliminé'}.` : ''}`}`;
      // Garde-fou : trop de rejeux d'affilée (ex. tout le monde mise pareil) -> mort subite
      if (etat.essai + 1 >= MAX_REJEUX && !etat.departage && absents.length < enJeu.length) {
        etat.departageAVenir = true;
        message += ' Trop d\'égalités : place à la mort subite !';
      } else if (elimines.length && !etat.departage && typeof mod.estTermine === 'function' && mod.estTermine({ etat: etat.etatJeu, enJeu: ontJoue })) {
        // les absents partis, le mini-jeu ne peut plus départager ceux qui restent (ex. minorité à 2)
        etat.departageAVenir = true;
        message = `${res.message ? res.message + ' ' : ''}${absents.length > 1 ? 'Les absents sont éliminés' : 'L\'absent est éliminé'}. Place à la mort subite entre les ${ontJoue.length} joueurs restants !`;
      }
    }

    etat.dernierResultat = {
      tour: tc.numero, essai: tc.essai, departage: etat.departage, resoluLe: Date.now(), final: false,
      survivants: rejoue ? (ontJoue.length ? ontJoue : enJeu) : survivants, elimines, absents: rejoue && !ontJoue.length ? [] : absents, rejoue, message,
      details: res.details ?? null,
    };
    etat.tourCourant = null;
    // Temps d'animation demandé par le mini-jeu (ex. cartes retournées une à une) : ajouté à la pause.
    const revelationMs = Math.min(15000, Math.max(0, Number(res.details?.revelationMs) || 0));
    etat.phase = 'resultats';

    // Dernier survivant : on montre d'abord les résultats de la manche décisive, puis le gagnant
    // (toujours automatiquement, même en mode manuel ; l'organisateur peut accélérer).
    if (!rejoue && survivants.length === 1) {
      etat.gagnantAVenir = survivants[0];
      etat.dernierResultat.final = true;
      etat.echeance = Date.now() + revelationMs + Math.max(4, etat.params.pauseResultats) * 1000;
      return;
    }
    // Plusieurs joueurs mais le jeu est « fini » (plus de questions, tours max…) -> mort subite.
    if (!rejoue && !etat.departage) {
      const fini = (typeof mod.estTermine === 'function' && mod.estTermine({ etat: etat.etatJeu, enJeu: survivants }))
        || etat.tour >= etat.params.toursMax;
      if (fini) {
        etat.departageAVenir = true;
        etat.dernierResultat.message = `${message ? message + ' ' : ''}Égalité entre ${survivants.length} joueurs : place à la mort subite !`;
      }
    }
    etat.echeance = etat.params.avanceAuto ? Date.now() + revelationMs + etat.params.pauseResultats * 1000 : null;
  }

  /** Après l'écran des résultats : annonce du gagnant, ou tour suivant. */
  async apresResultats(etat) {
    etat.pauseReglage = false;
    if (etat.gagnantAVenir) {
      const id = etat.gagnantAVenir;
      etat.gagnantAVenir = null;
      await this.terminer(etat, id);
    } else await this.demarrerTour(etat);
  }

  async terminer(etat, gagnantId) {
    etat.phase = 'termine';
    etat.gagnant = { id: gagnantId, pseudo: etat.joueurs[gagnantId].pseudo };
    etat.finLe = Date.now();
    etat.echeance = null;
    await this.archiver(etat);

    // Classement : 1 = gagnant ; ensuite par tour d'élimination (plus tard = mieux), ex aequo partagés.
    const elimines = etat.ordre.filter((id) => id !== gagnantId);
    const position = (id) => 2 + elimines.filter((x) => etat.joueurs[x].tourElimination > etat.joueurs[id].tourElimination).length;
    const groupes = new Map(); // "tour|position" -> ids
    for (const id of elimines) {
      const k = `${etat.joueurs[id].tourElimination ?? 0}|${position(id)}`;
      if (!groupes.has(k)) groupes.set(k, []);
      groupes.get(k).push(Number(id));
    }
    try {
      await prisma.$transaction([
        prisma.partie.update({
          where: { id: etat.partieId },
          data: { statut: 'TERMINEE', dateFin: new Date(), gagnantId: Number(gagnantId), nbTours: etat.tour },
        }),
        prisma.participation.updateMany({
          where: { partieId: etat.partieId, joueurId: Number(gagnantId) },
          data: { tourAtteint: etat.tour, positionFinale: 1 },
        }),
        ...[...groupes].map(([k, ids]) => {
          const [tour, pos] = k.split('|').map(Number);
          return prisma.participation.updateMany({
            where: { partieId: etat.partieId, joueurId: { in: ids } },
            data: { tourAtteint: tour, positionFinale: pos },
          });
        }),
      ]);
    } catch (e) { console.error('[moteur] enregistrement du gagnant', e.message); }
  }

  /** Retire la salle des salles actives ; l'état reste lisible quelques heures (écran du gagnant). */
  async archiver(etat) {
    await stockage.srem('salles:actives', etat.code);
    await stockage.expire(cleSalle(etat.code), TTL_SALLE_TERMINEE_S);
  }

  /** Après chaque transition : diffuse le nouvel état et programme la suivante. */
  apresTransition(etat) {
    this.diffuserEtat(etat).catch((e) => console.error('[moteur] diffusion', e));
    this.emettre('accueil', 'salles:maj', {});
    this.programmer(etat.code, etat.echeance);
  }

  programmer(code, quand) {
    clearTimeout(this.minuteurs.get(code));
    this.minuteurs.delete(code);
    if (!quand) return;
    const t = setTimeout(() => {
      this.minuteurs.delete(code);
      this.traiter(code).catch((e) => console.error('[moteur] minuteur', e));
    }, Math.max(0, quand - Date.now()) + 10);
    t.unref?.();
    this.minuteurs.set(code, t);
  }

  /**
   * Fait avancer la salle si une échéance est atteinte ou si tous les joueurs ont
   * joué. Sans effet sinon : peut donc être appelé n'importe quand, par n'importe
   * quelle instance.
   */
  async traiter(code) {
    await this.sousVerrou(code, async (etat) => {
      const maintenant = Date.now();
      let change = false;
      if (etat.phase === 'tour') {
        const tc = etat.tourCourant;
        let tousOntJoue = false;
        if (this.module(etat).actionRequise !== false) {
          const cle = cleActions(code, tc.numero, tc.essai);
          const n = parseInt((await stockage.get(`${cle}:n`)) || '0', 10);
          const dernierCoup = parseInt((await stockage.get(`${cle}:t`)) || '0', 10);
          tousOntJoue = n >= this.idsEnJeu(etat).length && maintenant - dernierCoup >= DELAI_DERNIER_COUP_MS;
        }
        if (tousOntJoue || maintenant >= etat.echeance) { await this.resoudreTour(etat); change = true; }
      } else if (etat.phase === 'resultats' && etat.echeance && maintenant >= etat.echeance) {
        await this.apresResultats(etat);
        change = true;
      }
      if (change) {
        await this.ecrire(etat);
        this.apresTransition(etat);
      } else if (etat.echeance && !this.minuteurs.has(code)) {
        this.programmer(code, etat.echeance);
      }
    }).catch((e) => { if (!e.estErreurJeu) throw e; });
  }

  /** Filet de sécurité multi-instances : vérifie les échéances de toutes les salles actives. */
  async scruter() {
    if (this.scrutationEnCours) return;
    this.scrutationEnCours = true;
    try {
      const codes = await stockage.smembers('salles:actives');
      const maintenant = Date.now();
      for (const code of codes) {
        const etat = await this.lire(code);
        if (!etat) { await stockage.srem('salles:actives', code); continue; }
        if (etat.echeance && maintenant >= etat.echeance) await this.traiter(code);
      }
    } finally { this.scrutationEnCours = false; }
  }

  // ------------------------------------------------------------------ vues pour le navigateur

  /** État visible par les navigateurs (jamais l'état interne du mini-jeu). */
  async vueClient(etatOuCode) {
    const etat = typeof etatOuCode === 'string' ? await this.lire(etatOuCode) : etatOuCode;
    if (!etat) return null;
    const mod = this.module(etat);
    const base = registre.obtenir(etat.miniJeu);
    let tourCourant = null;
    if (etat.phase === 'tour' && etat.tourCourant) {
      const tc = etat.tourCourant;
      const brut = await stockage.hgetall(cleActions(etat.code, tc.numero, tc.essai));
      const maintenant = Date.now();
      tourCourant = {
        numero: tc.numero, essai: tc.essai, debutMs: tc.debutMs, finMs: tc.finMs, public: tc.public,
        // pour une reconnexion : les événements déjà émis
        evenementsPasses: tc.evenements.filter((e) => tc.debutMs + e.dansMs <= maintenant).map((e) => ({ type: e.type, donnees: e.donnees ?? null })),
        actions: Object.entries(brut).map(([id, v]) => { const a = JSON.parse(v); return { joueurId: id, fini: a.f, public: a.p }; }),
      };
    }
    return {
      code: etat.code, phase: etat.phase,
      miniJeu: {
        id: base.id, nom: base.nom, icone: base.icone || '🎮', description: base.description,
        actionRequise: base.actionRequise !== false, regles: etat.phase === 'attente' ? this.regles(base, etat.params) : undefined,
      },
      jeuActif: { id: mod.id, nom: mod.nom, actionRequise: mod.actionRequise !== false },
      departage: etat.departage, params: etat.params, organisateur: etat.organisateur, objet: etat.objet || null, dateObjet: etat.dateObjet || null,
      reglagesOrga: etat.reglagesOrga || null, prochainTour: this.prochainTour(etat), pauseReglage: !!etat.pauseReglage,
      peutRegler: etat.phase === 'attente' || (etat.phase === 'resultats' && !etat.departage && !etat.departageAVenir && !etat.gagnantAVenir),
      joueurs: etat.ordre.map((id) => ({ id, ...etat.joueurs[id] })),
      tour: etat.tour, essai: etat.essai, tourCourant,
      dernierResultat: etat.dernierResultat, gagnant: etat.gagnant, annulee: etat.annulee,
      vue: typeof mod.vuePublique === 'function' && etat.etatJeu ? mod.vuePublique({ etat: etat.etatJeu }) : null,
      echeance: etat.echeance, maintenant: Date.now(),
    };
  }

  /** Règles du mini-jeu avec les paramètres de la partie (salle d'attente). */
  regles(mod, params) {
    try { return typeof mod.regles === 'function' ? mod.regles(params).filter(Boolean).map(String) : [mod.description]; }
    catch (e) { console.error('[moteur] règles', mod.id, e.message); return [mod.description]; }
  }

  async diffuserEtat(etat) {
    this.emettre(`salle:${etat.code}`, 'salle:etat', await this.vueClient(etat));
  }

  /**
   * Activité en cours (pour la pipeline : ne pas redéployer pendant une partie).
   *  - partiesEnCours : parties lancées et pas encore terminées ;
   *  - sallesAttente  : salles d'attente avec au moins un inscrit, créées il y a moins d'une heure
   *                     (une salle oubliée depuis longtemps ne bloque pas les déploiements).
   */
  async activite() {
    const codes = await stockage.smembers('salles:actives');
    let partiesEnCours = 0;
    let sallesAttente = 0;
    for (const code of codes) {
      const e = await this.lire(code);
      if (!e) continue;
      if (e.phase === 'tour' || e.phase === 'resultats') partiesEnCours++;
      else if (e.phase === 'attente' && e.ordre.length > 0 && Date.now() - e.creeLe < 3600 * 1000) sallesAttente++;
    }
    return { partiesEnCours, sallesAttente };
  }

  /** Résumé des salles actives pour la page d'accueil. */
  async listerSalles() {
    const codes = await stockage.smembers('salles:actives');
    const salles = [];
    for (const code of codes) {
      const e = await this.lire(code);
      if (!e) continue;
      const m = registre.obtenir(e.miniJeu);
      salles.push({
        code, phase: e.phase, miniJeu: { id: m.id, nom: m.nom, icone: m.icone || '🎮' }, objet: e.objet || null, dateObjet: e.dateObjet || null,
        organisateur: e.organisateur.pseudo, nbJoueurs: e.ordre.length,
        enJeu: this.idsEnJeu(e).length, tour: e.tour, creeLe: e.creeLe,
      });
    }
    return salles.sort((a, b) => b.creeLe - a.creeLe);
  }
}

module.exports = new Moteur();
module.exports.Moteur = Moteur;
module.exports.OBJETS = OBJETS;
module.exports.aujourdhui = aujourdhui;
