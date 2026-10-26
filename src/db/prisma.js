/**
 * Client Prisma unique pour toute l'application.
 * Mode « sans moteur binaire » (engineType = client) + pilote PostgreSQL `pg` :
 * plus léger, démarre plus vite sur Vercel et fonctionne avec Neon / Supabase.
 */
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function creerClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DB_CONNEXIONS_MAX || '10', 10),
  });
  return new PrismaClient({ adapter });
}

// Réutilise le client en cas de rechargement à chaud (évite d'ouvrir trop de connexions).
const globalPourPrisma = globalThis;
const prisma = globalPourPrisma.__prisma || creerClient();
globalPourPrisma.__prisma = prisma;

module.exports = prisma;
