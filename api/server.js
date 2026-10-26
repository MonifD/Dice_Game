/**
 * Entrée Vercel : Vercel Functions accepte un serveur HTTP Node exporté par défaut,
 * WebSockets compris (Fluid compute). Toutes les routes y sont redirigées (vercel.json).
 */
const { serveur } = require('../src/serveur');

module.exports = serveur;
