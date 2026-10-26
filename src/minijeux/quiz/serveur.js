/**
 * Mini-jeu : QUIZ (Last War ou culture générale)
 * Une question par tour (questions gérées dans l'administration).
 * Mauvaise réponse ou pas de réponse = éliminé. Si tout le monde se trompe, une nouvelle question est posée.
 * Plus de questions disponibles avec plusieurs survivants -> mort subite automatique.
 * Les réponses sont mélangées côté serveur et la bonne réponse n'est jamais envoyée avant les résultats.
 */
const { ErreurJeu } = require('../../moteur/outils');

module.exports = {
  id: 'quiz',
  ordre: 11,
  nom: 'Quiz',
  icone: '❓',
  description: 'Une question par tour. Mauvaise réponse ou pas de réponse = éliminé. Questions gérées dans l\'administration.',
  dureeTourDefaut: 20,
  parametres: [
    {
      cle: 'categorie', libelle: 'Catégorie de questions', type: 'choix', defaut: 'toutes',
      options: [{ valeur: 'toutes', libelle: 'Toutes' }, { valeur: 'Last War', libelle: 'Last War' }, { valeur: 'Culture générale', libelle: 'Culture générale' }],
    },
  ],

  async initialiser({ params, outils, rng }) {
    const where = { active: true, ...(params.categorie !== 'toutes' ? { categorie: params.categorie } : {}) };
    const questions = await outils.prisma.questionQuiz.findMany({ where });
    if (!questions.length) throw new ErreurJeu('Aucune question active dans cette catégorie : ajoute des questions dans l\'administration.');
    return {
      index: 0,
      questions: rng.melanger(questions).map((q) => ({ question: q.question, choix: q.choix, bonne: q.bonneReponse, categorie: q.categorie })),
    };
  },

  async debutTour({ etat, rng }) {
    const q = etat.questions[etat.index];
    const ordre = rng.melanger(q.choix.map((_, i) => i)); // ordre d'affichage secret
    const courante = { ...q, ordre };
    return {
      etat: { ...etat, index: etat.index + 1, courante },
      public: { consigne: q.question, question: q.question, categorie: q.categorie, choix: ordre.map((i) => q.choix[i]), numero: etat.index + 1, total: etat.questions.length },
    };
  },

  action({ etat, donnees }) {
    const r = Number(donnees.reponse); // index dans l'ordre AFFICHÉ
    if (!Number.isInteger(r) || r < 0 || r >= etat.courante.choix.length) throw new ErreurJeu('Réponse invalide.');
    return { enregistrer: { reponse: r }, public: null, prive: { reponse: r } };
  },

  async resoudreTour({ etat, actions }) {
    const q = etat.courante;
    const bonneAffichee = q.ordre.indexOf(q.bonne);
    const compte = q.choix.map(() => 0);
    const survivants = [];
    for (const [id, a] of Object.entries(actions)) {
      compte[a.reponse]++;
      if (a.reponse === bonneAffichee) survivants.push(id);
    }
    return {
      etat, survivants,
      message: `Bonne réponse : ${q.choix[q.bonne]}`,
      details: { type: 'quiz', question: q.question, choix: q.ordre.map((i) => q.choix[i]), bonne: bonneAffichee, compte },
    };
  },

  estTermine({ etat }) { return etat.index >= etat.questions.length; },
};
