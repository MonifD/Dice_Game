/**
 * Version de l'application.
 *
 * En production, la pipeline de livraison écrit un fichier version.json à la racine
 * (ex. { "version": "v1.3.0", "commit": "abc1234", "date": "…" }) dans le commit de release.
 * En local (pas de version.json), on affiche la version de package.json suivie de « -dev ».
 */
const fs = require('fs');
const path = require('path');

function lireVersion() {
  const racine = path.join(__dirname, '..', '..');
  try {
    const v = JSON.parse(fs.readFileSync(path.join(racine, 'version.json'), 'utf8'));
    if (v && v.version) return { version: String(v.version), commit: v.commit || null, date: v.date || null };
  } catch { /* pas de version.json : environnement de développement */ }
  const pkg = require('../../package.json');
  return {
    version: `v${pkg.version}-dev`,
    commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
    date: null,
  };
}

module.exports = lireVersion();
