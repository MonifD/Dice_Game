#!/usr/bin/env node
/**
 * Attend qu'aucune partie ne soit en cours sur le site avant de déployer
 * (un redéploiement coupe les parties en cours).
 *
 *   node scripts/ci/attendre-calme.js <url-du-site> [--minutes 30]
 *
 * - Sortie 0 : on peut déployer. Écrit version_actuelle=<version en production> dans $GITHUB_OUTPUT
 *   (sert au retour automatique en cas d'échec).
 * - Sortie 1 : toujours des parties en cours après le délai -> déploiement reporté
 *   (relancer le job plus tard depuis GitHub : « Re-run failed jobs »).
 * Si le site ne répond pas du tout, on déploie quand même (il n'y a rien à interrompre).
 */
const { attendre, sante, sortie, heure } = require('./sante');

(async () => {
  const [base] = process.argv.slice(2);
  const i = process.argv.indexOf('--minutes');
  const minutes = i > 0 ? Number(process.argv[i + 1]) : 30;
  if (!base) { console.error('Usage : attendre-calme.js <url> [--minutes N]'); process.exit(2); }

  const fin = Date.now() + minutes * 60000;
  let premier = true;
  for (;;) {
    const s = await sante(base);
    if (s.erreur) {
      if (premier) { console.log(`⚠️  Le site ne répond pas (${s.erreur}). Nouvel essai dans 30 s (réveil possible)…`); premier = false; await attendre(30000); continue; }
      console.log('⚠️  Le site ne répond toujours pas : rien à interrompre, on déploie.');
      sortie('version_actuelle', '');
      process.exit(0);
    }
    premier = false;
    const occupe = (s.partiesEnCours || 0) + (s.sallesAttente || 0);
    if (!occupe) {
      console.log(`✅ ${heure()} — aucune partie en cours (version en production : ${s.version}). On peut déployer.`);
      sortie('version_actuelle', /^v\d+\.\d+\.\d+$/.test(s.version) ? s.version : '');
      process.exit(0);
    }
    if (Date.now() > fin) {
      console.error(`❌ Toujours ${s.partiesEnCours} partie(s) en cours et ${s.sallesAttente} salle(s) d'attente après ${minutes} min.`
        + '\n   Déploiement reporté : relance ce job plus tard (« Re-run failed jobs »).');
      process.exit(1);
    }
    console.log(`⏸  ${heure()} — ${s.partiesEnCours} partie(s) en cours, ${s.sallesAttente} salle(s) d'attente : on attend 1 min…`);
    await attendre(60000);
  }
})();
