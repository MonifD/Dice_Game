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
 *  - R4, R5 et admins peuvent supprimer un message ; admins peuvent rendre muet.
 */
const crypto = require('crypto');
const { stockage } = require('../db/stockage');
const { ErreurJeu } = require('../moteur/outils');
const perms = require('./permissions');

const MAX_MESSAGES = 100;
const LONGUEUR_MAX = 200;
const CANAL_VALIDE = /^(general|salle:[A-Z0-9]{4,8})$/;

const cleMessages = (canal) => `chat:${canal}`;
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

async function historique(canal) {
  const brut = await stockage.lrange(cleMessages(verifierCanal(canal)), 0, MAX_MESSAGES - 1);
  return brut.map((m) => JSON.parse(m)).filter((m) => !m.supprime).reverse(); // du plus ancien au plus récent
}

/** Temps restant (ms) pendant lequel le joueur est muet, 0 sinon. */
async function restantMuet(joueurId) {
  const t = await stockage.ttl(cleMuet(joueurId));
  return t > 0 ? t : 0;
}

async function envoyer(canal, auteur, texte) {
  const c = verifierCanal(canal);
  const t = nettoyer(texte);
  const muet = await restantMuet(auteur.id);
  if (muet) throw new ErreurJeu(`Tu es muet encore ${Math.ceil(muet / 60000)} min.`);

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
  };
  await stockage.lpush(cleMessages(c), JSON.stringify(message));
  await stockage.ltrim(cleMessages(c), 0, MAX_MESSAGES - 1);
  await stockage.expire(cleMessages(c), c === 'general' ? 24 * 3600 : 12 * 3600);
  return message;
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
  await stockage.del(cleMessages(c));
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].supprime) await stockage.lpush(cleMessages(c), JSON.stringify(messages[i]));
  await stockage.expire(cleMessages(c), c === 'general' ? 24 * 3600 : 12 * 3600);
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

module.exports = { historique, envoyer, supprimer, rendreMuet, restantMuet, verifierCanal, LONGUEUR_MAX };
