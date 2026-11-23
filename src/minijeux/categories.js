/**
 * Catégories de la page « Jeux ».
 *
 *  - Un mini-jeu va dans « Jeux rapides » par défaut ; `categorie: 'soiree'` dans son serveur.js le range
 *    dans « Jeux de soirée ». `objets: ['AMUSEMENT']` le limite à « Pour s'amuser » (vérifié par le serveur).
 *  - BIENTOT : jeux annoncés mais pas encore codés (carte « Bientôt disponible »). Une carte disparaît
 *    d'elle-même dès qu'un dossier src/minijeux/<id>/ du même id existe.
 * Ajouter une catégorie = ajouter une ligne dans CATEGORIES.
 */
const CATEGORIES = [
  { id: 'rapide', nom: 'Jeux rapides', icone: '⚡', description: 'Mini-jeux d\'élimination en quelques tours : le dernier survivant gagne.' },
  { id: 'soiree', nom: 'Jeux de soirée', icone: '🌙', description: 'Jeux plus longs, à jouer ensemble pour le plaisir.' },
];

const BIENTOT = [
  {
    id: 'loup-garou', categorie: 'soiree', nom: 'Loup-Garou', icone: '🐺', objets: ['AMUSEMENT'],
    description: 'Villageois contre loups-garous : démasquez les loups avant qu\'ils ne dévorent le village.',
  },
];

const CATEGORIE_DEFAUT = 'rapide';

module.exports = { CATEGORIES, BIENTOT, CATEGORIE_DEFAUT };
