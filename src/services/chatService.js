/**
 * CHAT — salon « général » (page d'accueil) + un salon par salle de jeu.
 *
 * Messages gardés dans le stockage partagé (Redis) : les 100 derniers par salon
 * (24 h pour le général, 12 h pour une salle). Ils ne sont pas archivés en base.
 *
 * Règles :
 *  - 1 à 200 caractères, texte brut (le navigateur échappe le HTML à l'affichage) ;
 *  - anti-flood : 1 message / seconde et 6 messages / 15 secondes par joueur ;
 *  - un joueur rendu muet par un admin ne peut plus écrire pendant la durée choisie ;
 *  - R4, R5 et admins peuvent supprimer un message ; admins peuvent rendre muet ;
 *  - on peut répondre à un message (citation figée dans la réponse, effacée si l'original est supprimé) ;
 *  - réactions ❤ / 🎉 (emojis lw62 / lw74) : un clic ajoute, un 2e clic retire.
 *    Stockées à part dans un hash « chat:reac:<canal> », champ « <idMessage>:<emoji>:<idJoueur> » = pseudo,
 *    pour que deux joueurs qui réagissent en même temps ne s'écrasent pas.
 */
const crypto = require('crypto');
const { stockage } = require('../db/stockage');
const { ErreurJeu } = require('../moteur/outils');
const perms = require('./permissions');

const MAX_MESSAGES = 100;
const LONGUEUR_MAX = 200;
const CANAL_VALIDE = /^(general|salle:[A-Z0-9]{4,8})$/;
const ID_VALIDE = /^[a-f0-9]{12}$/;
/** Réactions autorisées : numéros des emojis Last War (public/emojis/lwNN.png). */
const REACTIONS = [62, 74]; // ❤ cœur, 🎉 confettis
const LONGUEUR_CITATION = 100;

const cleMessages = (canal) => `chat:${canal}`;
const cleReactions = (canal) => `chat:reac:${canal}`;
const dureeCanal = (canal) => (canal === 'general' ? 24 * 3600 : 12 * 3600);
const cleMuet = (joueurId) => `chat:muet:${joueurId}`;

function verifierCanal(canal) {
  const c = String(canal || '');
  if (!CANAL_VALIDE.test(c)) throw new ErreurJeu('Salon de discussion inconnu.');
  return c;
}

/** Nettoie le texte : espaces, caractères de contrôle, longueur. */
function nettoyer(texte) {
  // eslint-disable-next-line no-control-regex
  const t = String(texte ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) throw new ErreurJeu('Message vide.');
  if (t.length > LONGUEUR_MAX) throw new ErreurJeu(`${LONGUEUR_MAX} caractères maximum.`);
  return t;
}

async function lireMessages(c) {
  const brut = await stockage.lrange(cleMessages(c), 0, MAX_MESSAGES - 1);
  return brut.map((m) => JSON.parse(m));
}

/**
 * Réactions du salon regroupées par message : { idMessage: { '62': [{ id, pseudo }], '74': [...] } }.
 * `garder` : ids des messages encore présents ; les réactions des autres (messages supprimés ou
 * sortis des 100 derniers) sont effacées au passage.
 */
async function lireReactions(c, garder) {
  const brut = await stockage.hgetall(cleReactions(c));
  const parMessage = {};
  const orphelins = [];
  for (const [champ, pseudo] of Object.entries(brut || {})) {
    const [id, emoji, joueurId] = champ.split(':');
    if (garder && !garder.has(id)) { orphelins.push(champ); continue; }
    ((parMessage[id] ??= {})[emoji] ??= []).push({ id: joueurId, pseudo });
  }
  for (const champ of orphelins) await stockage.hdel(cleReactions(c), champ);
  return parMessage;
}

async function historique(canal) {
  const c = verifierCanal(canal);
  const messages = (await lireMessages(c)).filter((m) => !m.supprime);
  const reactions = await lireReactions(c, new Set(messages.map((m) => m.id)));
  for (const m of messages) m.reactions = reactions[m.id] || {};
  return messages.reverse(); // du plus ancien au plus récent
}

/** Extrait court du message cité (sans couper un code d'emoji « :lwNN: » en deux). */
function extrait(texte) {
  if (texte.length <= LONGUEUR_CITATION) return texte;
  return `${texte.slice(0, LONGUEUR_CITATION).replace(/:(l(w\d{0,2})?)?$/, '')}…`;
}

/** Temps restant (ms) pendant lequel le joueur est muet, 0 sinon. */
async function restantMuet(joueurId) {
  const t = await stockage.ttl(cleMuet(joueurId));
  return t > 0 ? t : 0;
}

async function envoyer(canal, auteur, texte, reponseA = null) {
  const c = verifierCanal(canal);
  const t = nettoyer(texte);
  const muet = await restantMuet(auteur.id);
  if (muet) throw new ErreurJeu(`Tu es muet encore ${Math.ceil(muet / 60000)} min.`);

  // réponse : on fige une citation du message d'origine (il peut sortir de l'historique ensuite)
  let reponse = null;
  if (reponseA) {
    const id = String(reponseA);
    const cible = ID_VALIDE.test(id) && (await lireMessages(c)).find((m) => m.id === id && !m.supprime);
    if (!cible) throw new ErreurJeu('Le message auquel tu réponds n\'existe plus.');
    reponse = { id: cible.id, auteur: { id: cible.auteur.id, pseudo: cible.auteur.pseudo }, texte: extrait(cible.texte) };
  }

  // anti-flood
  const rapide = await stockage.incr(`chat:flood1:${auteur.id}`);
  if (rapide === 1) await stockage.expire(`chat:flood1:${auteur.id}`, 1);
  const rafale = await stockage.incr(`chat:flood15:${auteur.id}`);
  if (rafale === 1) await stockage.expire(`chat:flood15:${auteur.id}`, 15);
  if (rapide > 1 || rafale > 6) throw new ErreurJeu('Doucement ! Attends un peu avant le prochain message.');

  const message = {
    id: crypto.randomBytes(6).toString('hex'),
    canal: c,
    auteur: { id: String(auteur.id), pseudo: auteur.pseudo, rang: auteur.rang, role: auteur.role },
    texte: t,
    date: Date.now(),
    ...(reponse ? { reponse } : {}),
  };
  await stockage.lpush(cleMessages(c), JSON.stringify(message));
  await stockage.ltrim(cleMessages(c), 0, MAX_MESSAGES - 1);
  await stockage.expire(cleMessages(c), dureeCanal(c));
  return { ...message, reactions: {} };
}

/**
 * Ajoute (ou retire si déjà mise) une réaction ❤ / 🎉 sur un message.
 * Renvoie toutes les réactions du message après le changement.
 */
async function reagir(canal, messageId, emoji, auteur) {
  const c = verifierCanal(canal);
  const e = Number(emoji);
  const id = String(messageId || '');
  if (!REACTIONS.includes(e)) throw new ErreurJeu('Réaction inconnue.');
  if (!ID_VALIDE.test(id)) throw new ErreurJeu('Message introuvable.');
  if (await restantMuet(auteur.id)) throw new ErreurJeu('Tu es muet pour le moment.');

  const cleFlood = `chat:floodreac:${auteur.id}`;
  const n = await stockage.incr(cleFlood);
  if (n === 1) await stockage.expire(cleFlood, 10);
  if (n > 15) throw new ErreurJeu('Doucement avec les réactions !');

  if (!(await lireMessages(c)).some((m) => m.id === id && !m.supprime)) throw new ErreurJeu('Message introuvable.');
  const champ = `${id}:${e}:${auteur.id}`;
  if ((await stockage.hget(cleReactions(c), champ)) !== null) await stockage.hdel(cleReactions(c), champ);
  else await stockage.hset(cleReactions(c), champ, auteur.pseudo);
  await stockage.expire(cleReactions(c), dureeCanal(c));

  const brut = await stockage.hgetall(cleReactions(c));
  const reactions = {};
  for (const [f, pseudo] of Object.entries(brut || {})) {
    const [mid, em, joueurId] = f.split(':');
    if (mid === id) (reactions[em] ??= []).push({ id: joueurId, pseudo });
  }
  return reactions;
}

/** Supprime un message (R4, R5, admins — ou l'auteur lui-même). */
async function supprimer(canal, messageId, auteur) {
  const c = verifierCanal(canal);
  const brut = await stockage.lrange(cleMessages(c), 0, MAX_MESSAGES - 1);
  const messages = brut.map((m) => JSON.parse(m));
  const cible = messages.find((m) => m.id === messageId);
  if (!cible) throw new ErreurJeu('Message introuvable.');
  if (cible.auteur.id !== String(auteur.id) && !perms.peutOrganiser(auteur)) throw new ErreurJeu('Tu ne peux pas supprimer ce message.');
  // réécriture de la liste (100 éléments max : opération légère)
  cible.supprime = true;
  // les réponses à ce message ne doivent plus montrer son texte
  for (const m of messages) if (m.reponse?.id === cible.id) m.reponse = { ...m.reponse, texte: '', supprime: true };
  await stockage.del(cleMessages(c));
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].supprime) await stockage.lpush(cleMessages(c), JSON.stringify(messages[i]));
  await stockage.expire(cleMessages(c), dureeCanal(c));
  return cible;
}

/** Rendre muet (admins) : `minutes` = 0 pour lever la sanction. */
async function rendreMuet(cible, minutes, auteur) {
  if (!perms.estAdmin(auteur)) throw new ErreurJeu('Réservé aux admins.');
  if (!perms.peutModifierCompte(auteur, cible)) throw new ErreurJeu('Tu ne peux pas rendre ce joueur muet.');
  const m = Math.max(0, Math.min(24 * 60, Math.round(Number(minutes) || 0)));
  if (m === 0) await stockage.del(cleMuet(cible.id));
  else await stockage.set(cleMuet(cible.id), '1', m * 60000);
  return m;
}

module.exports = { historique, envoyer, reagir, supprimer, rendreMuet, restantMuet, verifierCanal, LONGUEUR_MAX, REACTIONS };
