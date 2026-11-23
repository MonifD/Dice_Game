/**
 * Jeu de soirée : LOUP-GAROU.
 *
 * Module « libre » : il ne suit pas les tours d'élimination du moteur. Le moteur lui délègue tout le déroulé
 * (voir « Jeux libres » dans src/minijeux/index.js) ; la logique est dans ./logique.js.
 * Toujours « Pour s'amuser », de 6 à 18 joueurs. Le site joue le rôle du meneur.
 */
const L = require('./logique');

const libelleCompo = (c) => Object.entries(c).filter(([, n]) => n).map(([r, n]) => `${n} ${L.ROLES[r].nom}${n > 1 && r !== 'VILLAGEOIS' ? 's' : ''}`).join(', ');

module.exports = {
  id: 'loup-garou',
  nom: 'Loup-Garou',
  icone: '🐺',
  categorie: 'soiree',
  objets: ['AMUSEMENT'],
  libre: true,
  minJoueurs: L.MIN_JOUEURS,
  maxJoueurs: L.MAX_JOUEURS,
  description: 'Villageois contre loups-garous : démasquez les loups avant qu\'ils ne dévorent le village. De 6 à 18 joueurs, le site est le meneur.',
  parametresCommunsMasques: ['dureeTour', 'avanceAuto', 'pauseResultats', 'toursMax'],
  parametres: [
    { cle: 'cupidon', libelle: '💘 Cupidon (rôle optionnel)', type: 'booleen', defaut: false },
    { cle: 'salvateur', libelle: '🛡️ Salvateur (rôle optionnel)', type: 'booleen', defaut: false },
    {
      cle: 'nbLoups', libelle: 'Nombre de loups', type: 'nombre', min: 0, max: 8, defaut: 0,
      aide: '0 = automatique : 2 loups de 6 à 8 joueurs, 3 de 9 à 12, 4 de 13 à 18.',
    },
    { cle: 'dureeNuit', libelle: 'Action de nuit de chaque rôle (secondes)', type: 'nombre', min: 15, max: 120, defaut: 30 },
    { cle: 'dureeDebat', libelle: 'Débat de la journée (secondes)', type: 'nombre', min: 30, max: 900, defaut: 180 },
    { cle: 'dureeVote', libelle: 'Vote de la journée (secondes)', type: 'nombre', min: 20, max: 300, defaut: 60 },
    { cle: 'revelerRoles', libelle: 'Révéler le rôle des joueurs morts', type: 'booleen', defaut: true },
  ],

  regles: (p) => [
    'Chaque joueur reçoit une carte secrète. Les Loups-Garous veulent dévorer le village, les Villageois veulent démasquer les loups.',
    `Rôles : Loups-Garous (${p.nbLoups > 0 ? p.nbLoups : '2 à 4 selon le nombre de joueurs'}), Voyante, Sorcière, Chasseur${p.cupidon ? ', Cupidon' : ''}${p.salvateur ? ', Salvateur' : ''} et Simples Villageois.`,
    `La nuit, chaque rôle agit à son tour (${p.dureeNuit} s chacun) : ${p.cupidon ? 'Cupidon (1re nuit), ' : ''}${p.salvateur ? 'Salvateur, ' : ''}Voyante, Loups-Garous, Sorcière. Pas d'action avant la fin du minuteur = il ne se passe rien. Le chat du village est fermé la nuit.`,
    `Le jour : annonce des morts, débat (${Math.round(p.dureeDebat / 60 * 10) / 10} min) puis vote (${p.dureeVote} s). Le plus de voix est éliminé ; en cas d'égalité, second vote entre les ex aequo, puis personne.`,
    'Les morts deviennent spectateurs et discutent dans le Cimetière, invisible des vivants. Les loups ont leur propre salon secret.',
    'Victoire : Villageois si tous les loups sont morts ; Loups s\'ils sont au moins aussi nombreux que les villageois ; Amoureux d\'un camp différent s\'ils restent seuls.',
    ...Object.values(L.ROLES).map((r) => `${r.icone} ${r.nom} : ${r.description}`),
  ],

  /** Vérifie la composition au lancement (le nombre de joueurs n'est connu qu'à ce moment-là). */
  verifierLancement({ params, nbJoueurs }) { return libelleCompo(L.composition(nbJoueurs, params)); },

  initialiser({ params, joueurs, rng, maintenant }) { return L.creer({ params, joueurs, rng, maintenant }); },
  action({ etat, joueurId, donnees, maintenant, rng }) { const r = L.action(etat, joueurId, donnees || {}, maintenant, rng); return { etat, message: r.message }; },
  avancer({ etat, maintenant, rng }) { return { etat: L.avancer(etat, maintenant, rng) }; },
  passer({ etat, maintenant }) { return { etat: L.passer(etat, maintenant) }; },
  exclure({ etat, joueurId, maintenant }) { return { etat: L.exclure(etat, joueurId, maintenant) }; },
  echeance: ({ etat }) => L.echeance(etat),
  /** Vivant (true), mort (false) : pour la liste des joueurs du moteur. */
  statutJoueur: ({ etat, joueurId }) => ({ vivant: !!etat.joueurs[joueurId]?.vivant, quand: etat.joueurs[joueurId]?.mort?.quand || null }),
  fin: ({ etat }) => (etat.fin ? {
    camp: etat.fin.camp, libelle: etat.fin.libelle, gagnants: etat.fin.gagnants, numero: etat.numero,
  } : null),
  vuePublique: ({ etat, connectes }) => L.vuePublique(etat, { connectes }),
  vuePrivee: ({ etat, joueurId }) => L.vuePrivee(etat, joueurId),
  /** salon : 'village' (chat de la salle), 'loups', 'morts'. */
  droitsChat: ({ etat, joueurId, salon }) => L.droitsChat(etat, joueurId, salon),
  salons: ['loups', 'morts'],
  /** Boutons du meneur selon la phase. */
  actionsMeneur: ({ etat }) => (etat.phase === 'debat' ? [{ o: 'suivant', libelle: '⏭ Passer au vote' }] : []),
};
