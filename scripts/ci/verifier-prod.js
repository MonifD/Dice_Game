#!/usr/bin/env node
/**
 * Vérifie qu'une version est bien en ligne et fonctionne.
 *
 *   node scripts/ci/verifier-prod.js <url-du-site> <version attendue, ex. v1.3.0> [--minutes 20]
 *
 * 1. attend que /api/sante annonce la version attendue (Render met 2 à 5 min à construire) ;
 * 2. vérifie : page de connexion, configuration, une route protégée (401 attendu),
 *    et une tentative de connexion refusée (401 attendu : prouve que la base répond).
 * Sortie 0 = OK, 1 = échec (la pipeline revient alors à la version précédente).
 */
const { attendre, sante, heure } = require('./sante');

async function verifier(base, attendue, minutes = 20) {
  const url = base.replace(/\/$/, '');
  const fin = Date.now() + minutes * 60000;
  let derniere = null;
  for (;;) {
    const s = await sante(url);
    derniere = s.erreur || s.version;
    if (!s.erreur && s.version === attendue) break;
    if (Date.now() > fin) throw new Error(`la version ${attendue} n'est pas apparue en ${minutes} min (dernière réponse : ${derniere})`);
    console.log(`⏳ ${heure()} — en ligne : ${derniere} ; attendu : ${attendue}…`);
    await attendre(20000);
  }
  console.log(`🚀 ${attendue} est en ligne.`);

  const controles = [
    ['page de connexion', async () => {
      const r = await fetch(`${url}/`, { signal: AbortSignal.timeout(30000) });
      const html = await r.text();
      if (r.status !== 200 || !html.includes('Last War')) throw new Error(`HTTP ${r.status}`);
    }],
    ['configuration', async () => {
      const r = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(30000) });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    }],
    ['route protégée (401 attendu)', async () => {
      const r = await fetch(`${url}/api/minijeux`, { signal: AbortSignal.timeout(30000) });
      if (r.status !== 401) throw new Error(`HTTP ${r.status}`);
    }],
    ['base de données (connexion refusée attendue)', async () => {
      const r = await fetch(`${url}/api/auth/connexion`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ pseudo: 'verification-ci', motDePasse: 'pas-un-vrai-compte' }),
      });
      if (r.status !== 401) throw new Error(`HTTP ${r.status} : ${await r.text()}`);
    }],
  ];
  for (const [nom, fn] of controles) {
    await fn().catch((e) => { throw new Error(`${nom} : ${e.message}`); });
    console.log(`  ✅ ${nom}`);
  }
}

if (require.main === module) {
  const [base, attendue] = process.argv.slice(2);
  const i = process.argv.indexOf('--minutes');
  if (!base || !attendue) { console.error('Usage : verifier-prod.js <url> <version> [--minutes N]'); process.exit(2); }
  verifier(base, attendue, i > 0 ? Number(process.argv[i + 1]) : 20)
    .then(() => { console.log(`✅ Production vérifiée : ${attendue}`); process.exit(0); })
    .catch((e) => { console.error(`❌ Vérification échouée : ${e.message}`); process.exit(1); });
}

module.exports = { verifier };
