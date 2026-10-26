/**
 * Questions de départ pour le quiz (npm run seed). N'ajoute que les questions absentes.
 * Complète la catégorie « Last War » depuis l'administration avec les questions de ton alliance !
 */
require('dotenv').config({ quiet: true });
const prisma = require('../src/db/prisma');

const Q = (categorie, question, choix, bonneReponse) => ({ categorie, question, choix, bonneReponse });

const questions = [
  Q('Last War', 'Quel est le nom complet du jeu ?', ['Last War: Survival', 'Last Day on Earth', 'War Survival Z', 'Last Shelter'], 0),
  Q('Last War', 'Quel est le rang le plus élevé dans une alliance ?', ['R3', 'R4', 'R5', 'R6'], 2),
  Q('Culture générale', 'Quelle est la capitale de l\'Australie ?', ['Sydney', 'Melbourne', 'Canberra', 'Perth'], 2),
  Q('Culture générale', 'Combien de côtés a un hexagone ?', ['5', '6', '7', '8'], 1),
  Q('Culture générale', 'Quelle planète est surnommée « la planète rouge » ?', ['Vénus', 'Jupiter', 'Mars', 'Mercure'], 2),
  Q('Culture générale', 'Quel est le plus grand océan du monde ?', ['Atlantique', 'Indien', 'Arctique', 'Pacifique'], 3),
  Q('Culture générale', 'En quelle année l\'homme a-t-il marché sur la Lune pour la première fois ?', ['1965', '1969', '1972', '1975'], 1),
  Q('Culture générale', 'Quel est le symbole chimique de l\'or ?', ['Or', 'Ag', 'Au', 'Fe'], 2),
  Q('Culture générale', 'Combien y a-t-il de joueurs par équipe sur un terrain de football ?', ['9', '10', '11', '12'], 2),
  Q('Culture générale', 'Qui a peint « La Joconde » ?', ['Michel-Ange', 'Léonard de Vinci', 'Raphaël', 'Botticelli'], 1),
  Q('Culture générale', 'Quel est le plus long fleuve de France ?', ['La Seine', 'Le Rhône', 'La Loire', 'La Garonne'], 2),
  Q('Culture générale', 'Combien de continents compte-t-on traditionnellement ?', ['5', '6', '7', '8'], 2),
  Q('Culture générale', 'Quel animal est le plus grand mammifère du monde ?', ['L\'éléphant d\'Afrique', 'La baleine bleue', 'La girafe', 'Le cachalot'], 1),
  Q('Culture générale', 'Quelle est la langue la plus parlée au Brésil ?', ['Espagnol', 'Portugais', 'Brésilien', 'Anglais'], 1),
  Q('Culture générale', 'Combien de minutes dure une mi-temps au football (hors arrêts de jeu) ?', ['40', '45', '50', '60'], 1),
  Q('Culture générale', 'Quel pays a la forme d\'une botte ?', ['Grèce', 'Portugal', 'Italie', 'Croatie'], 2),
  Q('Culture générale', 'Quelle est la formule chimique de l\'eau ?', ['CO2', 'H2O', 'O2', 'NaCl'], 1),
  Q('Culture générale', 'Combien de jours compte une année bissextile ?', ['364', '365', '366', '367'], 2),
  Q('Culture générale', 'Quelle est la monnaie du Japon ?', ['Le yuan', 'Le won', 'Le yen', 'Le baht'], 2),
  Q('Culture générale', 'Quel organe pompe le sang dans le corps humain ?', ['Le foie', 'Les poumons', 'Le cœur', 'Les reins'], 2),
  Q('Culture générale', 'Dans quelle ville se trouve la tour Eiffel ?', ['Lyon', 'Paris', 'Marseille', 'Bruxelles'], 1),
  Q('Culture générale', 'Combien font 12 × 12 ?', ['124', '144', '132', '154'], 1),
  Q('Culture générale', 'Quel est le plus haut sommet du monde ?', ['Le K2', 'Le mont Blanc', 'L\'Everest', 'Le Kilimandjaro'], 2),
  Q('Culture générale', 'Quel gaz les plantes absorbent-elles pour la photosynthèse ?', ['L\'oxygène', 'L\'azote', 'Le dioxyde de carbone', 'L\'hélium'], 2),
  Q('Culture générale', 'Combien de cordes a une guitare classique ?', ['4', '5', '6', '7'], 2),
  Q('Culture générale', 'Quel est l\'animal emblème de la Chine, souvent offert en signe d\'amitié ?', ['Le tigre', 'Le panda géant', 'Le dragon de Komodo', 'La grue'], 1),
  Q('Culture générale', 'Combien d\'heures y a-t-il dans une semaine ?', ['144', '156', '168', '172'], 2),
  Q('Culture générale', 'Quel est le plus petit nombre premier ?', ['0', '1', '2', '3'], 2),
];

(async () => {
  let ajoutees = 0;
  for (const q of questions) {
    const existe = await prisma.questionQuiz.findFirst({ where: { question: q.question } });
    if (!existe) { await prisma.questionQuiz.create({ data: q }); ajoutees++; }
  }
  console.log(`${ajoutees} question(s) ajoutée(s).`);
  await prisma.$disconnect();
})();
