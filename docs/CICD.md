# 🚦 CI/CD — tests, versions et déploiement automatiques

Tout passe par GitHub Actions (gratuit et illimité : le dépôt est public).
**Rien n'arrive en production sans avoir passé les tests**, et on peut toujours revenir à une version précédente.

```
 push sur une branche (cicd, feat/…, fix/…)                         ⏱ ~3 min
   └─ 🧪 TESTS RAPIDES : syntaxe · unitaires · schéma Prisma · API & droits · chat · partie à 20 bots

 Pull request vers main                                              ⏱ ~15 min
   ├─ 🏷 titre de la PR vérifié (feat: / fix: … -> calcule la future version)
   ├─ 🧪 TESTS COMPLETS : + les 16 mini-jeux à 30 bots · 2 serveurs avec Redis · audit npm
   ├─ 💬 commentaire : « ✅ tests OK — deviendra la v1.3.0 »
   └─ 🔀 FUSION AUTOMATIQUE (squash) — sauf PR en brouillon / étiquette « ne-pas-fusionner »
          │
 main ────┘  (workflow « Livraison »)                                ⏱ ~20 min
   ├─ 🧪 TESTS COMPLETS rejoués sur le code fusionné
   ├─ 🏷 VERSION : calculée depuis le dernier tag
   ├─ 💾 SAUVEGARDE chiffrée de la base (si configurée)
   ├─ ⏸  ATTENTE : aucune partie en cours sur le site (30 min max)
   ├─ 🚀 tag vX.Y.Z -> branche « production » -> Render redéploie
   ├─ 🩺 VÉRIFICATION : le site répond, affiche vX.Y.Z, la base répond
   ├─ 📦 page de version publiée (onglet Releases)
   └─ ↩️ si la vérification échoue : RETOUR AUTOMATIQUE à la version précédente

 Bouton « Revenir à une version » (onglet Actions)  ->  vX.Y.Z redéployée + vérifiée
 Chaque nuit : 💾 sauvegarde chiffrée de la base (30 jours)
```

| Fichier (`.github/workflows/`) | Rôle |
|---|---|
| `tests.yml` | les tests, réutilisés par toutes les pipelines (rapides ou complets) |
| `tests-branche.yml` | push sur une branche autre que main / production |
| `pull-request.yml` | PR vers main : titre, tests complets, aperçu, fusion auto |
| `livraison.yml` | main : retest, version, sauvegarde, déploiement, vérification, retour auto |
| `revenir-version.yml` | bouton manuel de retour à une version |
| `sauvegarde-base.yml` | sauvegarde chiffrée de la base (nuit + avant chaque livraison) |

Scripts utilisés par la pipeline : `scripts/ci/` (version, attente de fin de partie, vérification du site).
Tests d'intégration : `tests/integration/` (API, droits, chat) et `tests/charge.js` (parties avec bots).

---

## Au quotidien

```bash
git checkout -b feat/bingo          # une branche par sujet (ou ta branche cicd)
# … modifications …
git commit -am "feat: mini-jeu Bingo"
git push -u origin feat/bingo       # -> tests rapides (onglet Actions)
```

Puis sur GitHub : **Compare & pull request** vers `main`, avec un **titre conventionnel** (voir ci-dessous).
C'est tout : si les tests passent, la PR est fusionnée, versionnée et déployée toute seule.
Tu suis tout dans l'onglet **Actions** ; GitHub t'envoie un e-mail si quelque chose échoue.

- **Pas encore prêt ?** Ouvre la PR en **brouillon** (« Create draft pull request ») : les tests tournent,
  mais pas de fusion. Clique « Ready for review » quand c'est bon.
- **Bloquer une PR** : ajoute l'étiquette `ne-pas-fusionner`.
- **Ta branche `cicd`** reste en place après la fusion (la pipeline ne supprime jamais les branches).
  Avant d'y retravailler : `git checkout cicd && git pull origin main` pour repartir du `main` à jour.

## Titres de PR et numéros de version

Versionnage sémantique `vMAJEUR.MINEUR.CORRECTIF`, calculé à partir du **titre de la PR** :

| Titre de la PR | Signification | Exemple |
|---|---|---|
| `fix: le chrono saute au tour 2` | correction | v1.2.**3** |
| `perf:` / `refactor:` / `build:` / `revert:` | amélioration interne | v1.2.**3** |
| `feat: mini-jeu Bingo` | nouveauté | v1.**3**.0 |
| `feat!: refonte des comptes` | changement cassant | v**2**.0.0 |
| `docs:` / `ci:` / `test:` / `chore:` / `style:` | rien pour les joueurs | pas de nouvelle version, pas de déploiement |

On peut préciser une zone : `feat(chat): emojis`, `fix(quiz): question en double`.
Un titre mal formé bloque la PR (le message d'erreur donne des exemples) : corrige le titre, les tests repartent.

La version en ligne est affichée en bas de chaque page du jeu et sur `/api/sante`.
Toutes les versions et leurs changements : onglet **Releases** du dépôt.

## Revenir à une version

**Automatique** : si le site ne répond pas correctement après un déploiement, la pipeline remet la version
précédente en production toute seule, et la livraison est marquée en échec.

**Manuel** : onglet **Actions** → **Revenir à une version** → **Run workflow** → tape la version (ex. `v1.2.2`).
Coche « Ne pas attendre la fin des parties en cours » seulement en urgence.

Ensuite, corrige le problème sur une branche et refais une PR : la livraison suivante reprend normalement.

## Base de données : la règle d'or

Le **code** revient en arrière, pas la **base**. Pour qu'une ancienne version fonctionne toujours :

- une migration **ajoute** (colonne optionnelle ou avec valeur par défaut, nouvelle table) ;
- elle ne **supprime / renomme** pas dans la même version : d'abord une version qui n'utilise plus
  l'ancienne colonne, puis — plus tard — une version qui la supprime.

Modifier le schéma : change `prisma/schema.prisma`, puis `npm run db:nouvelle-migration` (Docker lancé)
et commite le dossier `prisma/migrations/`. La pipeline refuse une PR dont le schéma n'a pas sa migration.

### Sauvegardes

Chaque nuit et avant chaque livraison, la base Neon est exportée, **chiffrée** (AES-256) et gardée 30 jours
dans les artefacts GitHub (onglet Actions → « Sauvegarde de la base » → section Artifacts).
Le dépôt étant public, la sauvegarde n'est jamais stockée en clair.

Restaurer (sur ton Mac, Docker lancé) :

```bash
# 1. télécharger l'artefact (zip) depuis GitHub, le dézipper, puis déchiffrer :
gpg --decrypt sauvegarde-AAAAMMJJ-HHMM.dump.gpg > base.dump      # demande SAUVEGARDE_MOT_DE_PASSE
# 2. restaurer vers une base (ATTENTION : écrase les tables existantes de la base cible) :
docker run --rm -i -e URL="adresse-neon-SANS-pooler" postgres:16 \
  sh -c 'pg_restore --clean --if-exists --no-owner -d "$URL"' < base.dump
```

Neon permet aussi de restaurer la base à un instant précis (Console Neon → Branches → Restore),
sur une période courte avec l'offre gratuite.

---

## Mise en place (une seule fois)

### 1. Vérifier les migrations (2 min, avant la première PR)
Dans le dossier du projet sur ton Mac, avec l'adresse Neon **sans** `-pooler` (lecture seule, ne modifie rien) :
```bash
npx prisma migrate diff --from-url "adresse-neon-SANS-pooler" --to-schema-datamodel prisma/schema.prisma --exit-code
```
Attendu : `No difference detected.` (sinon, envoie le résultat).

### 2. Créer la branche `production`
```bash
git push origin main:production
```

### 3. Render : suivre `production` au lieu de `main`
Render → service **last-war-arene** → **Settings** → **Build & Deploy** → **Branch** → `production` → Save.
À partir de là, un push sur `main` ne déploie plus rien directement : seule la pipeline met à jour `production`.

### 4. (Recommandé) Sauvegardes — secrets GitHub
Dépôt → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** :
- `NEON_DIRECT_URL` : adresse Neon **sans** `-pooler` ;
- `SAUVEGARDE_MOT_DE_PASSE` : une longue phrase secrète (note-la dans ton gestionnaire de mots de passe :
  sans elle, les sauvegardes sont illisibles).

Facultatif : variable `PROD_URL` (onglet **Variables**) si l'adresse du site change
(par défaut `https://last-war-arene.onrender.com`).

### 5. Fusionner la branche `cicd`
```bash
git add -A && git commit -m "ci: pipeline CI/CD" && git push origin cicd
```
Ouvre une PR `cicd` → `main` intitulée **`ci: pipeline CI/CD`**. Comme aucune version n'existe encore,
la première livraison publiera **v1.0.0** et la déploiera.

### 6. Protéger `main` (après la première PR, quand les tests apparaissent dans la liste)
Dépôt → **Settings** → **Rules** → **Rulesets** → **New branch ruleset** :
- nom : `main protégée` · Enforcement : **Active** · Target branches : **Include default branch** ;
- cocher **Restrict deletions**, **Block force pushes** ;
- cocher **Require a pull request before merging** (0 approbation requise) ;
- cocher **Require status checks to pass** et ajouter :
  `Titre de la PR`, `Tests / Statique (syntaxe, unitaires, schéma)`,
  `Tests / Intégration (API, chat, parties avec bots)`, `Tests / Multi-instances (Redis, 2 serveurs)`.

Ne protège pas la branche `production` : la pipeline doit pouvoir la mettre à jour.

---

## Dépannage

| Symptôme | Que faire |
|---|---|
| ❌ « Titre de PR invalide » | Modifie le titre de la PR (bouton Edit) : les tests repartent seuls. |
| ❌ un test échoue | Onglet Actions → clique sur l'étape rouge pour lire l'erreur ; corrige et repousse sur la branche. |
| ⏸ « Déploiement reporté » | Une partie était en cours pendant 30 min. Onglet Actions → la livraison → **Re-run failed jobs**. |
| ↩️ « retour automatique à vX » | La nouvelle version ne marchait pas en ligne : la précédente est revenue. Regarde les logs Render. |
| ⚠️ « Migration manquante » | `npm run db:nouvelle-migration` en local, commite `prisma/migrations/`. |
| 😴 la vérification attend longtemps | Normal sur le plan gratuit : Render construit puis réveille le serveur (jusqu'à ~5 min). |
| 💤 plus de sauvegarde nocturne | GitHub suspend les tâches planifiées après 60 jours sans activité sur le dépôt : un push les réactive. |
