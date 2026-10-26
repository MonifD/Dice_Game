/**
 * Configuration centrale : toutes les valeurs viennent des variables d'environnement.
 * Voir .env.example pour la liste complète.
 */
require('dotenv').config({ quiet: true });

const env = process.env;

const config = {
  env: env.NODE_ENV || 'development',
  port: parseInt(env.PORT || '3000', 10),

  // Base PostgreSQL (lue directement par Prisma : DATABASE_URL / DIRECT_URL)
  databaseUrl: env.DATABASE_URL,

  // Redis : si absent, un stockage en mémoire est utilisé (UNE seule instance, dev local).
  redisUrl: env.REDIS_URL || '',

  // Authentification
  jwtSecret: env.JWT_SECRET || '',
  jwtDuree: env.JWT_DUREE || '7d',
  cookieNom: 'lw_session',

  // Le super admin est créé/promu automatiquement au démarrage avec ce pseudo.
  superAdminPseudo: env.SUPER_ADMIN_PSEUDO || '',
  superAdminMotDePasse: env.SUPER_ADMIN_MOT_DE_PASSE || '',

  // Origines autorisées pour Socket.IO / API quand le front est hébergé ailleurs
  // (ex. front sur Vercel, temps réel sur Render). Liste séparée par des virgules.
  origines: (env.ORIGINES_AUTORISEES || '').split(',').map((s) => s.trim()).filter(Boolean),

  // Chemin Socket.IO (identique côté client). /api/socket.io fonctionne partout, y compris Vercel.
  socketPath: env.SOCKET_PATH || '/api/socket.io',

  // URL publique du serveur temps réel si différent du site (vide = même domaine)
  urlTempsReel: env.URL_TEMPS_REEL || '',

  // Limite de participants par salle
  maxJoueursParSalle: parseInt(env.MAX_JOUEURS_PAR_SALLE || '150', 10),
};

if (!config.jwtSecret) {
  if (config.env === 'production') {
    throw new Error('JWT_SECRET est obligatoire en production.');
  }
  config.jwtSecret = 'secret-de-developpement-a-changer';
  console.warn('[config] JWT_SECRET absent : secret de développement utilisé.');
}

module.exports = config;
