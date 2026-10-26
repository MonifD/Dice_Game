/** Outils communs aux scripts de vérification de la production. */

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON avec délai max (le plan gratuit de Render peut mettre ~1 min à se réveiller). */
async function lireJson(url, timeoutMs = 90000) {
  const rep = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'Cache-Control': 'no-cache' } });
  if (!rep.ok) throw new Error(`HTTP ${rep.status} sur ${url}`);
  return rep.json();
}

/** Lit /api/sante ; renvoie { erreur } si le site ne répond pas. */
async function sante(base) {
  try { return await lireJson(`${base.replace(/\/$/, '')}/api/sante`); } catch (e) { return { erreur: e.message }; }
}

function sortie(cle, valeur) {
  if (process.env.GITHUB_OUTPUT) require('fs').appendFileSync(process.env.GITHUB_OUTPUT, `${cle}=${valeur ?? ''}\n`);
}

const heure = () => new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });

module.exports = { attendre, lireJson, sante, sortie, heure };
