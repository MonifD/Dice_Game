/**
 * Registre des mini-jeux.
 *
 * Chaque dossier de src/minijeux/ contenant un fichier serveur.js est chargé
 * automatiquement. AJOUTER UN MINI-JEU = créer un dossier avec :
 *   - serveur.js : la logique (voir INTERFACE ci-dessous) ;
 *   - client.js  : l'affichage dans le navigateur (servi sur /minijeux/<id>/client.js).
 * Aucune modification du moteur n'est nécessaire.
 *
 * INTERFACE d'un module serveur.js
 * ---------------------------------
 *  id, nom, description, icone        textes affichés
 *  parametres: [{ cle, libelle, type: 'nombre'|'choix'|'booleen'|'texte', min, max, defaut, options }]
 *  dureeTourDefaut  (s)               durée par défaut d'un tour (paramètre commun « dureeTour »)
 *  actionRequise    (défaut true)     false = tour automatique (ex. roue) : personne n'est éliminé pour absence
 *
 *  async initialiser({ params, joueurs, rng, outils })            -> etat
 *  async debutTour({ etat, tour, essai, enJeu, params, rng })      -> { etat, public?, evenements?, dureeMs? }
 *        public     : données envoyées à tous au début du tour (ex. la question du quiz)
 *        evenements : [{ dansMs, type, donnees }] émis pendant le tour (ex. feu vert)
 *  action({ etat, joueurId, donnees, precedent, ecouleMs, params, rng })
 *        -> { enregistrer, fini = true, public?, prive? }  (lever ErreurJeu pour refuser)
 *        enregistrer : ce qui est stocké pour ce joueur ce tour-ci (remplace « precedent »)
 *        fini        : le joueur a terminé son tour (une seule action par défaut)
 *        public      : diffusé à tous immédiatement (ex. résultat du dé) ; null = caché jusqu'aux résultats
 *        prive       : renvoyé uniquement au joueur
 *  async resoudreTour({ etat, actions, enJeu, params, rng, tour })
 *        actions : { [joueurId]: enregistrer } — uniquement les joueurs ayant agi
 *        -> { etat, survivants: [ids], details, message? }
 *        Le moteur élimine en plus les absents, rejoue le tour si plus personne ne survit
 *        et termine la partie s'il reste un seul joueur.
 *  estTermine?({ etat, enJeu })  -> true pour finir (départage automatique s'il reste plusieurs joueurs)
 *  vuePublique?({ etat })        -> infos permanentes visibles de tous (ex. points des enchères)
 *  commandeOrganisateur?({ donnees, params, prochainTour })
 *        -> réglages du prochain tour choisis par l'organisateur en salle d'attente ou entre deux tours
 *           (ex. options A / B de « La minorité ») ; reçus ensuite dans initialiser/debutTour({ reglages }).
 *           Côté navigateur : LW.miniJeux[id].orga(zone, ctx) affiche le formulaire (ctx.envoyer(donnees)).
 */
const fs = require('fs');
const path = require('path');

const PARAM_TYPES = ['nombre', 'choix', 'booleen', 'texte'];
const registre = new Map();

function verifierModule(m, dossier) {
  const manque = ['id', 'nom', 'initialiser', 'debutTour', 'action', 'resoudreTour'].filter((k) => !m[k]);
  if (manque.length) throw new Error(`Mini-jeu « ${dossier} » : il manque ${manque.join(', ')}`);
  for (const p of m.parametres || []) {
    if (!p.cle || !PARAM_TYPES.includes(p.type)) throw new Error(`Mini-jeu « ${m.id} » : paramètre invalide ${JSON.stringify(p)}`);
  }
}

function charger() {
  const racine = __dirname;
  for (const dossier of fs.readdirSync(racine).sort()) {
    const fichier = path.join(racine, dossier, 'serveur.js');
    if (!fs.existsSync(fichier)) continue;
    const m = require(fichier);
    verifierModule(m, dossier);
    m.dossier = path.join(racine, dossier);
    m.ordre = m.ordre ?? 100;
    registre.set(m.id, m);
  }
}
charger();

const obtenir = (id) => registre.get(id) || null;

/** Description publique des mini-jeux (pour le formulaire de création). */
function catalogue() {
  const { parametresCommuns } = require('../moteur/parametres');
  return [...registre.values()]
    .sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom))
    .map((m) => ({
      id: m.id, nom: m.nom, description: m.description, icone: m.icone || '🎮',
      parametres: [...(m.parametres || []), ...parametresCommuns(m)],
    }));
}

module.exports = { obtenir, catalogue, registre };
