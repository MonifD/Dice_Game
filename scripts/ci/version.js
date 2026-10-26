#!/usr/bin/env node
/**
 * Calcule la prochaine version (versionnage sémantique vMAJEUR.MINEUR.CORRECTIF) à partir
 * des messages de commit depuis le dernier tag, selon la convention « Conventional Commits » :
 *
 *   feat!: …  /  « BREAKING CHANGE »   -> version MAJEURE   v1.4.2 -> v2.0.0
 *   feat: …                            -> version MINEURE   v1.4.2 -> v1.5.0
 *   fix: / perf: / refactor: / revert: / build: / message libre -> CORRECTIF  v1.4.2 -> v1.4.3
 *   docs: / ci: / test: / chore: / style:  -> rien à livrer (aucun changement pour les joueurs)
 *
 * Premier lancement (aucun tag) : v1.0.0.
 *
 * Usage :
 *   node scripts/ci/version.js                     calcule la version de HEAD
 *   node scripts/ci/version.js --ref <sha>         … d'un commit précis
 *   node scripts/ci/version.js --titre "feat: x"   aperçu : « si cette PR était fusionnée »
 *   node scripts/ci/version.js --verifier-titre "feat: x"   vérifie seulement le format d'un titre de PR
 * Dans GitHub Actions, les résultats sont aussi écrits dans $GITHUB_OUTPUT
 * (version, precedente, livrer, niveau) et les notes de version dans notes-version.md.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

const TYPES = ['feat', 'fix', 'perf', 'refactor', 'revert', 'build', 'docs', 'ci', 'test', 'chore', 'style'];
const SANS_LIVRAISON = ['docs', 'ci', 'test', 'chore', 'style'];
const REGEX_TITRE = new RegExp(`^(${TYPES.join('|')})(\\([\\w\\-./ ]+\\))?(!)?: .{3,}`);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** Analyse un sujet de commit / titre de PR. */
function analyser(sujet) {
  const m = REGEX_TITRE.exec(sujet.trim());
  if (!m) return { type: null, cassant: /BREAKING CHANGE/.test(sujet) };
  return { type: m[1], cassant: !!m[3] };
}

const estConventionnel = (titre) => REGEX_TITRE.test(String(titre || '').trim());

function versionsTriees() {
  const tags = git('tag', '--list', 'v*').split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const n = (t) => t.slice(1).split('.').map(Number);
  return tags.sort((a, b) => { const [x, y] = [n(a), n(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
}

/** Sujets « utiles » des commits entre le dernier tag et ref (PR fusionnées comprises). */
function sujetsDepuis(dernier, ref) {
  const plage = dernier ? `${dernier}..${ref}` : ref;
  // --first-parent : seulement la ligne principale de main (commits « squash » et commits de fusion de PR),
  // pas les commits intermédiaires des branches (« wip », « test »…)
  const brut = git('log', '--first-parent', plage, '--format=%B%x1e');
  return brut.split('\x1e').map((m) => m.trim()).filter(Boolean).map((message) => {
    const lignes = message.split('\n').map((l) => l.trim());
    // « Merge pull request #12 from x/y » : le titre de la PR est sur la ligne suivante non vide
    if (/^Merge pull request #\d+/.test(lignes[0])) {
      const titre = lignes.slice(1).find(Boolean) || '';
      const num = /#(\d+)/.exec(lignes[0])[1];
      return { sujet: `${titre} (#${num})`, cassant: /BREAKING CHANGE/.test(message) };
    }
    if (/^Merge (branch|remote-tracking branch)/.test(lignes[0])) return null; // fusions internes
    return { sujet: lignes[0], cassant: /BREAKING CHANGE/.test(message) };
  }).filter(Boolean);
}

function prochaine(precedente, niveau) {
  if (!precedente) return 'v1.0.0';
  const [maj, min, cor] = precedente.slice(1).split('.').map(Number);
  if (niveau === 'majeure') return `v${maj + 1}.0.0`;
  if (niveau === 'mineure') return `v${maj}.${min + 1}.0`;
  return `v${maj}.${min}.${cor + 1}`;
}

function calculer({ ref = 'HEAD', titre = null } = {}) {
  const tags = versionsTriees();
  const precedente = tags[tags.length - 1] || null;
  const sujets = sujetsDepuis(precedente, ref);
  if (titre) sujets.unshift({ sujet: titre, cassant: false });

  let niveau = null;
  for (const { sujet, cassant } of sujets) {
    const a = analyser(sujet);
    let n;
    if (a.cassant || cassant) n = 'majeure';
    else if (a.type === 'feat') n = 'mineure';
    else if (a.type && SANS_LIVRAISON.includes(a.type)) n = null;
    else n = 'correctif'; // fix, perf, refactor, revert, build ou message libre
    const rang = { majeure: 3, mineure: 2, correctif: 1 };
    if (n && (!niveau || rang[n] > rang[niveau])) niveau = n;
  }
  const premiere = !precedente;
  const livrer = premiere || !!niveau;
  const version = livrer ? prochaine(precedente, niveau) : precedente;
  return { version, precedente, livrer, niveau: premiere ? 'premiere' : niveau, sujets: sujets.map((s) => s.sujet) };
}

function notes(r) {
  const lignes = r.sujets.map((s) => `- ${s}`).join('\n') || '- (aucun changement listé)';
  const libelle = { majeure: '💥 Version majeure', mineure: '✨ Nouveautés', correctif: '🐛 Corrections', premiere: '🎉 Première version' }[r.niveau] || '';
  return `## ${libelle}\n\n${lignes}\n\n${r.precedente ? `Version précédente : ${r.precedente}` : ''}\n`;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

  if (args.includes('--verifier-titre')) {
    const t = val('--verifier-titre');
    if (estConventionnel(t)) { console.log(`✅ Titre valide : « ${t} »`); process.exit(0); }
    console.error(`❌ Titre de PR invalide : « ${t} »
Il doit commencer par un type suivi de « : », par exemple :
  feat: nouveau mini-jeu Bingo        (nouveauté      -> version mineure)
  fix: le chrono saute au tour 2      (correction     -> correctif)
  feat!: refonte des comptes          (changement cassant -> version majeure)
  docs: / ci: / test: / chore:        (pas de nouvelle version)
Types possibles : ${TYPES.join(', ')}`);
    process.exit(1);
  }

  const r = calculer({ ref: val('--ref') || 'HEAD', titre: val('--titre') });
  console.log(r.livrer
    ? `Version : ${r.precedente || '(aucune)'} -> ${r.version} (${r.niveau})`
    : `Rien à livrer depuis ${r.precedente} (seulement docs/ci/test/chore/style).`);
  r.sujets.forEach((s) => console.log(`  · ${s}`));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${r.version || ''}\nprecedente=${r.precedente || ''}\nlivrer=${r.livrer}\nniveau=${r.niveau || ''}\n`);
  }
  fs.writeFileSync('notes-version.md', notes(r));
}

module.exports = { calculer, estConventionnel, analyser, prochaine };
