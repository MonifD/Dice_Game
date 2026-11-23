/**
 * LOUP-GAROU — logique pure du jeu (aucun accès réseau ni base : testable seule).
 *
 * L'état complet (avec les rôles) ne quitte JAMAIS le serveur. Le navigateur ne reçoit que :
 *  - vuePublique(etat)          : ce que tout le monde peut savoir (phase, vivants / morts, votes du jour…) ;
 *  - vuePrivee(etat, joueurId)  : ce que CE joueur a le droit de savoir (son rôle, les autres loups s'il est loup,
 *                                 ses visions s'il est voyante, la victime s'il est sorcière…).
 *
 * Déroulé : distribution -> nuit (cupidon, salvateur, voyante, loups, sorcière) -> annonce des morts
 *           -> débat -> vote (-> second vote entre ex aequo) -> annonce -> nuit suivante…
 *           Un chasseur qui meurt tire avant la suite ; un amoureux qui meurt entraîne l'autre.
 * Toutes les fonctions modifient l'état reçu et le renvoient.
 */
const { ErreurJeu } = require('../../moteur/outils');

const ROLES = {
  LOUP: { nom: 'Loup-Garou', icone: '🐺', camp: 'loups', description: 'Chaque nuit, avec les autres loups, tu choisis une victime à dévorer. Les loups se connaissent entre eux. Le jour, fais-toi passer pour un villageois !' },
  VILLAGEOIS: { nom: 'Simple Villageois', icone: '🧑‍🌾', camp: 'village', description: 'Aucun pouvoir, mais ta voix compte : débats et votes chaque jour pour démasquer les loups.' },
  VOYANTE: { nom: 'Voyante', icone: '🔮', camp: 'village', description: 'Chaque nuit, tu découvres le rôle d\'un joueur de ton choix. Aide le village sans te faire repérer par les loups.' },
  SORCIERE: { nom: 'Sorcière', icone: '🧪', camp: 'village', description: 'Tu vois la victime des loups. Potion de vie : la sauver. Potion de mort : éliminer un joueur. Chacune une seule fois dans la partie. Tu ne peux pas te sauver toi-même.' },
  CHASSEUR: { nom: 'Chasseur', icone: '🏹', camp: 'village', description: 'Quand tu meurs (nuit ou jour), tu as 30 secondes pour éliminer immédiatement un joueur de ton choix.' },
  CUPIDON: { nom: 'Cupidon', icone: '💘', camp: 'village', description: 'La première nuit, tu désignes deux amoureux (toi compris si tu veux). Si l\'un meurt, l\'autre meurt de chagrin.' },
  SALVATEUR: { nom: 'Salvateur', icone: '🛡️', camp: 'village', description: 'Chaque nuit, tu protèges un joueur contre les loups. Pas la même personne deux nuits de suite. Tu peux te protéger toi-même.' },
};

/** Étapes de la nuit, dans l'ordre, et le rôle qui agit. */
const ETAPES = [
  { id: 'cupidon', role: 'CUPIDON', texte: '💘 Cupidon se réveille et désigne deux amoureux…', premiereNuit: true },
  { id: 'salvateur', role: 'SALVATEUR', texte: '🛡️ Le Salvateur se réveille et choisit qui protéger…' },
  { id: 'voyante', role: 'VOYANTE', texte: '🔮 La Voyante se réveille et sonde l\'âme d\'un joueur…' },
  { id: 'loups', role: 'LOUP', texte: '🐺 Les Loups-Garous se réveillent et choisissent leur victime…' },
  { id: 'sorciere', role: 'SORCIERE', texte: '🧪 La Sorcière se réveille et prépare ses potions…' },
];

const CAUSES = {
  loups: 'dévoré(e) par les loups',
  sorciere: 'empoisonné(e) par la sorcière',
  vote: 'éliminé(e) par le vote du village',
  chasseur: 'abattu(e) par le chasseur',
  chagrin: 'mort(e) de chagrin d\'amour',
  exclu: 'exclu(e) de la partie (absent)',
};

const MIN_JOUEURS = 6;
const MAX_JOUEURS = 18;
const DUREE_DISTRIBUTION_MS = 12000;
const DUREE_CHASSEUR_MS = 30000;
const ATTENTE_ETAPE_FICTIVE_MS = [5000, 9000]; // rôle mort : on attend quand même (sinon tout le monde le saurait)
const DELAI_VOTES_COMPLETS_MS = 3000;

/** Nombre de loups conseillé : 6-8 joueurs -> 2, 9-12 -> 3, 13-18 -> 4. */
const loupsConseilles = (n) => (n <= 8 ? 2 : n <= 12 ? 3 : 4);

/** Rôles spéciaux de la partie (hors loups et villageois). */
const speciaux = (params) => ['VOYANTE', 'SORCIERE', 'CHASSEUR', ...(params.cupidon ? ['CUPIDON'] : []), ...(params.salvateur ? ['SALVATEUR'] : [])];

/** Composition { ROLE: nombre } pour n joueurs ; lève une erreur si elle est impossible. */
function composition(n, params) {
  if (n < MIN_JOUEURS) throw new ErreurJeu(`Il faut au moins ${MIN_JOUEURS} joueurs prêts pour le Loup-Garou.`);
  if (n > MAX_JOUEURS) throw new ErreurJeu(`${MAX_JOUEURS} joueurs maximum pour le Loup-Garou.`);
  const nbLoups = Number(params.nbLoups) > 0 ? Number(params.nbLoups) : loupsConseilles(n);
  const sp = speciaux(params);
  if (nbLoups * 2 >= n) throw new ErreurJeu(`${nbLoups} loups pour ${n} joueurs, c'est trop : les loups doivent être moins nombreux que les villageois (${loupsConseilles(n)} conseillés).`);
  if (nbLoups + sp.length > n) throw new ErreurJeu(`Pas assez de joueurs pour ${nbLoups} loups et ${sp.length} rôles spéciaux.`);
  const c = { LOUP: nbLoups, VILLAGEOIS: n - nbLoups - sp.length };
  for (const r of sp) c[r] = (c[r] || 0) + 1;
  return c;
}

// ------------------------------------------------------------------ utilitaires

const vivants = (e) => e.ordre.filter((id) => e.joueurs[id].vivant);
const pseudo = (e, id) => e.joueurs[id]?.pseudo || '?';
const libelleQuand = (e) => `${e.phase === 'nuit' || e.phase === 'distribution' ? 'Nuit' : 'Jour'} ${Math.max(1, e.numero)}`;
const estVivant = (e, id) => !!e.joueurs[id]?.vivant;
const acteurs = (e, role) => vivants(e).filter((id) => e.joueurs[id].role === role);

function noter(e, maintenant, texte, type = 'info') {
  e.journal.push({ t: maintenant, quand: libelleQuand(e), texte, type });
  if (e.journal.length > 80) e.journal.splice(0, e.journal.length - 80);
}

/** Le plus de voix ; égalité -> tirage au sort parmi les ex aequo (si aucun vote : null). */
function plusDeVoix(votes, rng, { departager = true } = {}) {
  const compte = new Map();
  for (const cible of Object.values(votes)) if (cible) compte.set(cible, (compte.get(cible) || 0) + 1);
  if (!compte.size) return { gagnant: null, exAequo: [] };
  const max = Math.max(...compte.values());
  const exAequo = [...compte].filter(([, n]) => n === max).map(([id]) => id);
  if (exAequo.length === 1) return { gagnant: exAequo[0], exAequo };
  return { gagnant: departager ? rng.choisir(exAequo) : null, exAequo };
}

// ------------------------------------------------------------------ création

/**
 * @param {{ joueurs: {id, pseudo}[], params: object, rng: object, maintenant: number }} o
 */
function creer({ joueurs, params, rng, maintenant }) {
  const compo = composition(joueurs.length, params);
  const cartes = Object.entries(compo).flatMap(([role, n]) => Array(n).fill(role));
  const distribuees = rng.melanger(cartes);
  const e = {
    params: {
      cupidon: !!params.cupidon, salvateur: !!params.salvateur, revelerRoles: params.revelerRoles !== false,
      dureeNuitMs: params.dureeNuit * 1000, dureeDebatMs: params.dureeDebat * 1000, dureeVoteMs: params.dureeVote * 1000,
    },
    composition: compo,
    ordre: joueurs.map((j) => String(j.id)),
    joueurs: {},
    numero: 0,
    phase: 'distribution',
    etape: null,
    etapeFictive: false,
    finMs: maintenant + DUREE_DISTRIBUTION_MS,
    narration: '🃏 Les cartes sont distribuées. Découvre ton rôle, et garde-le secret !',
    amoureux: null,
    protege: null,
    dernierProtege: null,
    visions: [],
    votesLoups: {},
    victimeSorciere: null,
    potions: { vie: true, mort: true },
    sorciere: { sauve: false, tue: null },
    etapeFaite: false,
    votes: {},
    candidats: null,
    tourVote: 0,
    annonces: null, // { titre, morts: [...], messages: [...] }
    suite: null, // après l'annonce : 'debat' ou 'nuit'
    chasseurs: [], // chasseurs morts qui doivent encore tirer
    chasseur: null, // chasseur en train de choisir
    journal: [],
    resume: [],
    fin: null,
  };
  joueurs.forEach((j, i) => {
    e.joueurs[String(j.id)] = { pseudo: j.pseudo, role: distribuees[i], vivant: true, roleRevele: false, mort: null };
  });
  noter(e, maintenant, e.narration, 'nuit');
  return e;
}

// ------------------------------------------------------------------ nuit

function debuterNuit(e, maintenant, rng) {
  e.numero += 1;
  e.phase = 'nuit';
  e.protege = null;
  e.votesLoups = {};
  e.victimeSorciere = null;
  e.sorciere = { sauve: false, tue: null };
  e.victimeLoups = undefined; // fixée à la fin de l'étape des loups
  e.votes = {};
  e.candidats = null;
  e.annonces = null;
  e.narration = '🌙 La nuit tombe sur le village… Tout le monde s\'endort.';
  noter(e, maintenant, `🌙 Nuit ${e.numero} : la nuit tombe sur le village.`, 'nuit');
  allerEtape(e, maintenant, rng, 0);
}

/** Victime désignée par les loups (plus de voix, égalité tirée au sort), avant protection et potion. */
function victimeDesLoups(e, rng) {
  const votes = {};
  for (const [loup, cible] of Object.entries(e.votesLoups)) if (estVivant(e, loup) && estVivant(e, cible)) votes[loup] = cible;
  return plusDeVoix(votes, rng).gagnant;
}

function allerEtape(e, maintenant, rng, index) {
  for (let i = index; i < ETAPES.length; i++) {
    const et = ETAPES[i];
    if (et.premiereNuit && e.numero !== 1) continue;
    if (!e.composition[et.role]) continue; // rôle absent de la partie : pas d'étape
    e.etape = et.id;
    e.etapeIndex = i;
    e.etapeFaite = false;
    e.narration = et.texte;
    const actifs = acteurs(e, et.role);
    e.etapeFictive = actifs.length === 0;
    e.finMs = maintenant + (e.etapeFictive ? rng.entier(...ATTENTE_ETAPE_FICTIVE_MS) : e.params.dureeNuitMs);
    if (et.id === 'sorciere') {
      // La victime est fixée au réveil de la sorcière (après le vote des loups et la protection du salvateur).
      if (e.victimeLoups === undefined) e.victimeLoups = victimeDesLoups(e, rng);
      const v = e.victimeLoups;
      e.victimeSorciere = v && v !== e.protege ? v : null;
    }
    return;
  }
  finNuit(e, maintenant, rng);
}

function etapeSuivante(e, maintenant, rng) {
  if (e.etape === 'loups' && e.victimeLoups === undefined) e.victimeLoups = victimeDesLoups(e, rng);
  allerEtape(e, maintenant, rng, e.etapeIndex + 1);
}

function finNuit(e, maintenant, rng) {
  const victime = e.victimeLoups !== undefined ? e.victimeLoups : victimeDesLoups(e, rng);
  const morts = [];
  if (victime && estVivant(e, victime) && victime !== e.protege && !e.sorciere.sauve) morts.push([victime, 'loups']);
  if (e.sorciere.tue && estVivant(e, e.sorciere.tue) && !morts.some(([id]) => id === e.sorciere.tue)) morts.push([e.sorciere.tue, 'sorciere']);
  e.dernierProtege = e.protege;
  e.victimeLoups = undefined;
  e.etape = null;
  e.annonces = { titre: '☀️ Le village se réveille…', morts: [], messages: [] };
  noter(e, maintenant, `☀️ Jour ${e.numero} : le village se réveille.`, 'jour');
  for (const [id, cause] of morts) tuer(e, id, cause, maintenant); // encore « Nuit N » pour le résumé
  if (!e.annonces.morts.length) e.annonces.messages.push('Le village se réveille, personne n\'est mort cette nuit.');
  e.suite = 'debat';
  demarrerAnnonce(e, maintenant);
}

// ------------------------------------------------------------------ morts

/** Fait mourir un joueur (+ son amoureux), note le chasseur qui doit tirer. Les morts de la nuit ne disent pas la cause. */
function tuer(e, id, cause, maintenant) {
  const j = e.joueurs[id];
  if (!j || !j.vivant) return;
  const quand = e.phase === 'nuit' ? `Nuit ${e.numero}` : `Jour ${Math.max(1, e.numero)}`;
  j.vivant = false;
  j.roleRevele = e.params.revelerRoles || cause === 'exclu';
  j.mort = { cause, quand };
  e.resume.push({ id, pseudo: j.pseudo, role: j.role, quand, cause, texte: CAUSES[cause] });
  delete e.votes[id];
  delete e.votesLoups[id];
  const nuit = cause === 'loups' || cause === 'sorciere';
  const texte = `💀 ${j.pseudo} ${nuit ? 'a été retrouvé(e) mort(e)' : `a été ${CAUSES[cause]}`}${j.roleRevele ? ` : c'était ${ROLES[j.role].icone} ${ROLES[j.role].nom}` : ''}.`;
  e.annonces?.morts.push({ id, pseudo: j.pseudo, cause: nuit ? null : cause, role: j.roleRevele ? j.role : null, texte });
  noter(e, maintenant, texte, 'mort');
  if (j.role === 'CHASSEUR' && cause !== 'exclu') e.chasseurs.push(id);
  if (e.amoureux?.includes(id)) {
    const autre = e.amoureux.find((x) => x !== id);
    if (estVivant(e, autre)) tuer(e, autre, 'chagrin', maintenant);
  }
}

function demarrerAnnonce(e, maintenant, texteJournal) {
  e.phase = 'annonce';
  e.narration = e.annonces.titre;
  if (texteJournal) noter(e, maintenant, texteJournal, 'jour');
  for (const m of e.annonces.messages) noter(e, maintenant, m, 'info');
  e.finMs = maintenant + 6000 + 3500 * e.annonces.morts.length;
}

/** Après une annonce : chasseur qui doit tirer, victoire, ou suite (débat / nuit). */
function apresAnnonce(e, maintenant, rng) {
  while (e.chasseurs.length) {
    const id = e.chasseurs.shift();
    e.phase = 'chasseur';
    e.chasseur = id;
    e.narration = `🏹 ${pseudo(e, id)} était le Chasseur ! Dans un dernier souffle, il choisit qui emporter avec lui…`;
    e.finMs = maintenant + DUREE_CHASSEUR_MS;
    noter(e, maintenant, e.narration, 'mort');
    return;
  }
  if (verifierVictoire(e, maintenant)) return;
  if (e.suite === 'debat') debuterDebat(e, maintenant);
  else debuterNuit(e, maintenant, rng);
}

function tirChasseur(e, cible, maintenant) {
  const id = e.chasseur;
  e.chasseur = null;
  e.annonces = { titre: '🏹 Le coup de feu du Chasseur', morts: [], messages: [] };
  if (cible) tuer(e, cible, 'chasseur', maintenant);
  else e.annonces.messages.push(`${pseudo(e, id)} n'a tiré sur personne.`);
  demarrerAnnonce(e, maintenant);
  e.finMs = maintenant + 4000 + 3500 * e.annonces.morts.length;
}

// ------------------------------------------------------------------ jour

function debuterDebat(e, maintenant) {
  e.phase = 'debat';
  e.annonces = null;
  e.finMs = maintenant + e.params.dureeDebatMs;
  e.narration = '🗣️ Débat : qui sont les loups ? Discutez dans le chat du village.';
  noter(e, maintenant, `🗣️ Jour ${e.numero} : début du débat.`, 'jour');
}

function debuterVote(e, maintenant, candidats = null) {
  e.phase = candidats ? 'vote2' : 'vote';
  e.tourVote = candidats ? 2 : 1;
  e.votes = {};
  e.candidats = candidats;
  e.finMs = maintenant + e.params.dureeVoteMs;
  e.narration = candidats
    ? `⚖️ Égalité ! Second vote, uniquement entre ${candidats.map((id) => pseudo(e, id)).join(', ')}.`
    : '🗳️ Vote : chaque joueur vivant vote pour éliminer un joueur.';
  noter(e, maintenant, e.narration, 'jour');
}

function resoudreVote(e, maintenant, rng) {
  const votes = {};
  for (const [de, pour] of Object.entries(e.votes)) {
    if (estVivant(e, de) && estVivant(e, pour) && (!e.candidats || e.candidats.includes(pour))) votes[de] = pour;
  }
  const { gagnant, exAequo } = plusDeVoix(votes, rng, { departager: false });
  if (!gagnant && exAequo.length > 1 && e.phase === 'vote') { debuterVote(e, maintenant, exAequo); return; }
  e.annonces = { titre: '🗳️ Résultat du vote', morts: [], messages: [] };
  if (gagnant) tuer(e, gagnant, 'vote', maintenant);
  else e.annonces.messages.push(exAequo.length > 1 ? 'Encore une égalité : personne n\'est éliminé aujourd\'hui.' : 'Personne n\'a voté : personne n\'est éliminé aujourd\'hui.');
  e.votesFinaux = Object.entries(votes).map(([de, pour]) => ({ de, pour }));
  e.suite = 'nuit';
  demarrerAnnonce(e, maintenant);
}

// ------------------------------------------------------------------ victoire

/** Vérifie la fin de partie ; renvoie true (et remplit e.fin) si elle est terminée. */
function verifierVictoire(e, maintenant) {
  const v = vivants(e);
  const loups = v.filter((id) => e.joueurs[id].role === 'LOUP');
  const autres = v.filter((id) => e.joueurs[id].role !== 'LOUP');
  const couple = e.amoureux;
  const coupleMixte = couple && (e.joueurs[couple[0]].role === 'LOUP') !== (e.joueurs[couple[1]].role === 'LOUP');
  let camp = null;
  let gagnants = [];
  if (!v.length) camp = 'egalite';
  else if (coupleMixte && v.length === 2 && couple.every((id) => v.includes(id))) { camp = 'amoureux'; gagnants = [...couple]; }
  else if (!loups.length) { camp = 'village'; gagnants = e.ordre.filter((id) => e.joueurs[id].role !== 'LOUP' && !(coupleMixte && couple.includes(id))); }
  else if (loups.length >= autres.length) { camp = 'loups'; gagnants = e.ordre.filter((id) => e.joueurs[id].role === 'LOUP'); }
  if (!camp) return false;
  const libelles = {
    village: '🧑‍🌾 Les Villageois gagnent !', loups: '🐺 Les Loups-Garous gagnent !',
    amoureux: '💘 Les Amoureux gagnent ensemble !', egalite: '☠️ Tout le monde est mort : égalité, personne ne gagne.',
  };
  e.phase = 'fin';
  e.etape = null;
  e.finMs = null;
  e.chasseur = null;
  e.narration = libelles[camp];
  e.fin = { camp, libelle: libelles[camp], gagnants };
  noter(e, maintenant, libelles[camp], 'fin');
  return true;
}

// ------------------------------------------------------------------ actions des joueurs

function exigerCible(e, cible, { pasSoi = null, parmi = null, vivante = true } = {}) {
  const c = String(cible ?? '');
  if (!e.joueurs[c]) throw new ErreurJeu('Choisis un joueur de la partie.');
  if (vivante && !e.joueurs[c].vivant) throw new ErreurJeu(`${pseudo(e, c)} est déjà mort(e).`);
  if (pasSoi && c === pasSoi) throw new ErreurJeu('Tu ne peux pas te choisir toi-même.');
  if (parmi && !parmi.includes(c)) throw new ErreurJeu('Ce joueur ne fait pas partie des choix possibles.');
  return c;
}

/**
 * Action d'un joueur. Le serveur vérifie tout : phase, rôle, vivant, cibles.
 * @returns {{ etat, message? }}
 */
function action(e, joueurId, donnees, maintenant, rng) {
  const id = String(joueurId);
  const j = e.joueurs[id];
  if (!j) throw new ErreurJeu('Tu ne participes pas à cette partie (spectateur).');
  if (e.phase === 'fin') throw new ErreurJeu('La partie est terminée.');

  if (e.phase === 'chasseur') {
    if (e.chasseur !== id) throw new ErreurJeu('Ce n\'est pas à toi d\'agir.');
    const cible = exigerCible(e, donnees.cible, { pasSoi: id });
    tirChasseur(e, cible, maintenant);
    return { message: `Tu as tiré sur ${pseudo(e, cible)}.` };
  }
  if (!j.vivant) throw new ErreurJeu('Tu es mort(e) : tu ne peux plus agir.');

  if (e.phase === 'vote' || e.phase === 'vote2') {
    if (donnees.cible === null) { delete e.votes[id]; return { message: 'Vote retiré.' }; }
    const cible = exigerCible(e, donnees.cible, { pasSoi: id, parmi: e.candidats });
    e.votes[id] = cible;
    if (vivants(e).every((x) => e.votes[x])) e.finMs = Math.min(e.finMs, maintenant + DELAI_VOTES_COMPLETS_MS);
    return { message: `Tu votes contre ${pseudo(e, cible)}.` };
  }

  if (e.phase !== 'nuit' || !e.etape) throw new ErreurJeu('Ce n\'est pas le moment d\'agir.');
  const et = ETAPES[e.etapeIndex];
  if (j.role !== et.role) throw new ErreurJeu('Ce n\'est pas à toi d\'agir : le village dort…');
  if (e.etapeFaite && e.etape !== 'loups') throw new ErreurJeu('Tu as déjà agi cette nuit.');

  switch (e.etape) {
    case 'cupidon': {
      const cibles = Array.isArray(donnees.cibles) ? donnees.cibles.map(String) : [];
      if (cibles.length !== 2 || cibles[0] === cibles[1]) throw new ErreurJeu('Choisis deux joueurs différents.');
      cibles.forEach((c) => exigerCible(e, c));
      e.amoureux = cibles;
      e.etapeFaite = true;
      etapeSuivante(e, maintenant, rng);
      return { message: `${pseudo(e, cibles[0])} et ${pseudo(e, cibles[1])} sont désormais amoureux.` };
    }
    case 'salvateur': {
      const cible = exigerCible(e, donnees.cible);
      if (cible === e.dernierProtege) throw new ErreurJeu('Tu as déjà protégé ce joueur la nuit dernière.');
      e.protege = cible;
      e.etapeFaite = true;
      etapeSuivante(e, maintenant, rng);
      return { message: `Tu protèges ${pseudo(e, cible)} cette nuit.` };
    }
    case 'voyante': {
      const cible = exigerCible(e, donnees.cible, { pasSoi: id });
      e.visions.push({ nuit: e.numero, cible, role: e.joueurs[cible].role });
      e.etapeFaite = true;
      etapeSuivante(e, maintenant, rng);
      return { message: `${pseudo(e, cible)} est ${ROLES[e.joueurs[cible].role].nom}.` };
    }
    case 'loups': {
      const loups = acteurs(e, 'LOUP');
      const cible = exigerCible(e, donnees.cible, { parmi: vivants(e).filter((x) => e.joueurs[x].role !== 'LOUP') });
      e.votesLoups[id] = cible;
      // tous les loups vivants d'accord : on passe sans attendre la fin du minuteur
      if (loups.every((l) => e.votesLoups[l] === cible)) { e.etapeFaite = true; e.victimeLoups = cible; etapeSuivante(e, maintenant, rng); }
      return { message: `Tu votes pour dévorer ${pseudo(e, cible)}.` };
    }
    case 'sorciere': {
      if (donnees.potion === 'vie') {
        if (!e.potions.vie) throw new ErreurJeu('Tu as déjà utilisé ta potion de vie.');
        if (!e.victimeSorciere) throw new ErreurJeu('Il n\'y a personne à sauver cette nuit.');
        if (e.victimeSorciere === id) throw new ErreurJeu('Tu ne peux pas te sauver toi-même.');
        e.potions.vie = false;
        e.sorciere.sauve = true;
        return { message: `Tu sauves ${pseudo(e, e.victimeSorciere)}.` };
      }
      if (donnees.potion === 'mort') {
        if (!e.potions.mort) throw new ErreurJeu('Tu as déjà utilisé ta potion de mort.');
        const cible = exigerCible(e, donnees.cible, { pasSoi: id });
        e.potions.mort = false;
        e.sorciere.tue = cible;
        return { message: `Tu empoisonnes ${pseudo(e, cible)}.` };
      }
      if (donnees.terminer) {
        e.etapeFaite = true;
        etapeSuivante(e, maintenant, rng);
        return { message: 'Tu te rendors.' };
      }
      throw new ErreurJeu('Action inconnue.');
    }
    default:
      throw new ErreurJeu('Action inconnue.');
  }
}

/** Échéance atteinte : passe à la suite (étape suivante, débat, vote…). */
function avancer(e, maintenant, rng) {
  switch (e.phase) {
    case 'distribution': debuterNuit(e, maintenant, rng); break;
    case 'nuit': etapeSuivante(e, maintenant, rng); break;
    case 'annonce': apresAnnonce(e, maintenant, rng); break;
    case 'debat': debuterVote(e, maintenant); break;
    case 'vote': case 'vote2': resoudreVote(e, maintenant, rng); break;
    case 'chasseur': tirChasseur(e, null, maintenant); break;
    default:
  }
  return e;
}

/** Bouton du meneur : passer le débat (directement au vote). */
function passer(e, maintenant) {
  if (e.phase !== 'debat') throw new ErreurJeu('On ne peut passer que le débat.');
  debuterVote(e, maintenant);
  return e;
}

/** Exclusion d'un joueur absent par le meneur : considéré comme mort, rôle révélé. */
function exclure(e, joueurId, maintenant) {
  const id = String(joueurId);
  if (!e.joueurs[id]) throw new ErreurJeu('Joueur inconnu.');
  if (!e.joueurs[id].vivant) throw new ErreurJeu(`${pseudo(e, id)} est déjà mort(e).`);
  const annoncesAvant = e.annonces;
  e.annonces = annoncesAvant || { titre: '', morts: [], messages: [] };
  tuer(e, id, 'exclu', maintenant);
  if (!annoncesAvant) e.annonces = null;
  if (e.chasseur === id) tirChasseur(e, null, maintenant);
  verifierVictoire(e, maintenant);
  return e;
}

const echeance = (e) => (e.phase === 'fin' ? null : e.finMs);

// ------------------------------------------------------------------ vues

const role = (r) => ({ id: r, ...ROLES[r] });

/** Ce que tout le monde voit (aucun rôle secret). */
function vuePublique(e, { connectes = null } = {}) {
  const fini = e.phase === 'fin';
  return {
    phase: e.phase,
    etape: e.etape,
    numero: e.numero,
    finMs: e.finMs,
    narration: e.narration,
    composition: e.composition,
    revelerRoles: e.params.revelerRoles,
    joueurs: e.ordre.map((id) => {
      const j = e.joueurs[id];
      return {
        id, pseudo: j.pseudo, vivant: j.vivant,
        role: fini || (!j.vivant && j.roleRevele) ? j.role : null,
        mort: j.mort ? { quand: j.mort.quand, cause: fini || !['loups', 'sorciere'].includes(j.mort.cause) ? j.mort.cause : null } : null,
        connecte: connectes ? connectes.has(id) : null,
      };
    }),
    annonces: e.phase === 'annonce' ? e.annonces : null,
    vote: e.phase === 'vote' || e.phase === 'vote2'
      ? { tour: e.tourVote, candidats: e.candidats, votes: Object.entries(e.votes).map(([de, pour]) => ({ de, pour })) } : null,
    votesFinaux: e.phase === 'annonce' && e.suite === 'nuit' ? e.votesFinaux || null : null,
    chasseur: e.phase === 'chasseur' ? e.chasseur : null,
    journal: e.journal.slice(-40),
    fin: fini ? {
      ...e.fin,
      roles: e.ordre.map((id) => ({ id, pseudo: e.joueurs[id].pseudo, role: e.joueurs[id].role, vivant: e.joueurs[id].vivant, amoureux: !!e.amoureux?.includes(id) })),
      resume: e.resume,
    } : null,
  };
}

/** Action attendue de ce joueur maintenant (ou null). */
function actionDe(e, id) {
  const j = e.joueurs[id];
  const v = vivants(e);
  if (e.phase === 'chasseur' && e.chasseur === id) return { type: 'chasseur', cibles: v.filter((x) => x !== id), finMs: e.finMs };
  if (!j.vivant) return null;
  if (e.phase === 'vote' || e.phase === 'vote2') {
    return { type: 'vote', cibles: (e.candidats || v).filter((x) => x !== id && estVivant(e, x)), choix: e.votes[id] || null, finMs: e.finMs };
  }
  if (e.phase !== 'nuit' || !e.etape || e.etapeFictive) return null;
  const et = ETAPES[e.etapeIndex];
  if (j.role !== et.role) return null;
  const base = { type: e.etape, finMs: e.finMs, fait: e.etapeFaite };
  switch (e.etape) {
    case 'cupidon': return { ...base, cibles: v, nb: 2 };
    case 'salvateur': return { ...base, cibles: v.filter((x) => x !== e.dernierProtege), interdit: e.dernierProtege };
    case 'voyante': return { ...base, cibles: v.filter((x) => x !== id) };
    case 'loups': return {
      ...base, fait: false, cibles: v.filter((x) => e.joueurs[x].role !== 'LOUP'), choix: e.votesLoups[id] || null,
      votes: Object.entries(e.votesLoups).filter(([l]) => estVivant(e, l)).map(([de, pour]) => ({ de, pour })),
    };
    case 'sorciere': return {
      ...base, cibles: v.filter((x) => x !== id), victime: e.victimeSorciere,
      potions: { ...e.potions }, sauve: e.sorciere.sauve, tue: e.sorciere.tue,
      peutSauver: e.potions.vie && !!e.victimeSorciere && e.victimeSorciere !== id,
    };
    default: return null;
  }
}

/** Ce que CE joueur a le droit de savoir. null pour un spectateur. */
function vuePrivee(e, joueurId) {
  const id = String(joueurId);
  const j = e.joueurs[id];
  if (!j) return null;
  const r = j.role;
  return {
    role: role(r),
    vivant: j.vivant,
    loups: r === 'LOUP' ? e.ordre.filter((x) => e.joueurs[x].role === 'LOUP').map((x) => ({ id: x, pseudo: pseudo(e, x), vivant: e.joueurs[x].vivant })) : null,
    partenaire: e.amoureux?.includes(id) ? (() => { const p = e.amoureux.find((x) => x !== id); return { id: p, pseudo: pseudo(e, p), vivant: estVivant(e, p) }; })() : null,
    amoureux: r === 'CUPIDON' && e.amoureux ? e.amoureux.map((x) => ({ id: x, pseudo: pseudo(e, x) })) : null,
    visions: r === 'VOYANTE' ? e.visions.map((v) => ({ nuit: v.nuit, id: v.cible, pseudo: pseudo(e, v.cible), role: role(v.role) })) : null,
    potions: r === 'SORCIERE' ? { ...e.potions } : null,
    dernierProtege: r === 'SALVATEUR' && e.dernierProtege ? { id: e.dernierProtege, pseudo: pseudo(e, e.dernierProtege) } : null,
    action: actionDe(e, id),
  };
}

/**
 * Droits sur les salons de discussion :
 *  - village : tout le monde lit ; écrire = joueur vivant, le jour (fermé la nuit) ;
 *  - loups   : loups vivants seulement ;
 *  - morts   : « Cimetière » pour les morts et les spectateurs, invisible des vivants.
 * Après la partie, tout le monde lit et écrit partout.
 */
function droitsChat(e, joueurId, salon) {
  const j = e.joueurs[String(joueurId)];
  if (e.phase === 'fin') return { lire: true, ecrire: true };
  const nuit = e.phase === 'nuit' || e.phase === 'distribution';
  if (salon === 'village') {
    return { lire: true, ecrire: !!j?.vivant && !nuit, raison: !j ? 'Les spectateurs ne peuvent pas écrire aux vivants pendant la partie : utilise le Cimetière.' : !j.vivant ? 'Les morts ne parlent plus aux vivants : utilise le Cimetière.' : nuit ? '🌙 Le village dort : le chat est fermé la nuit.' : null };
  }
  if (salon === 'loups') { const ok = !!j?.vivant && j.role === 'LOUP'; return { lire: ok, ecrire: ok, raison: ok ? null : 'Salon réservé aux loups.' }; }
  if (salon === 'morts') { const ok = !j || !j.vivant; return { lire: ok, ecrire: ok, raison: ok ? null : 'Le Cimetière est réservé aux morts.' }; }
  return { lire: false, ecrire: false, raison: 'Salon inconnu.' };
}

module.exports = {
  ROLES, ETAPES, CAUSES, MIN_JOUEURS, MAX_JOUEURS, loupsConseilles, composition,
  creer, action, avancer, passer, exclure, echeance, vuePublique, vuePrivee, droitsChat, verifierVictoire, vivants,
};
