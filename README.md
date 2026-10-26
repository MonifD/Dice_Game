# ⚔ Last War Arène

Mini-jeux d'élimination en temps réel pour une alliance **Last War: Survival**.
Jusqu'à 100 joueurs (et plus) jouent depuis leur téléphone ou leur ordinateur. Un R4, un R5 ou un admin choisit un
mini-jeu, les joueurs s'éliminent tour après tour, **un seul gagnant** à la fin, et tout est enregistré
(pseudo, partie, mini-jeu, date, gagnant).

**Stack** : Node.js 20+, Express, Socket.IO, Prisma + PostgreSQL (Neon/Supabase), Redis (Upstash).
Interface 100 % en français, sans étape de build.
Détails techniques (dossiers, tables, événements Socket.IO) : [ARCHITECTURE.md](ARCHITECTURE.md).

## Les 16 mini-jeux

| | Mini-jeu | Règle |
|---|---|---|
| 🎲 | Lancer de dé | Tour 1 : faire le nombre choisi par l'organisateur. Ensuite : seuls les plus hauts résultats passent. |
| 🪙 | Pile ou face | Ceux qui se trompent sont éliminés. |
| ⚖️ | La minorité gagne | A ou B : seul le camp le moins nombreux survit. Idéal pour réduire vite 100 joueurs. |
| 🔢 | Nombre mystère | 1 à 100 : la moitié la plus éloignée du nombre tiré est éliminée. |
| ✊ | Pierre-feuille-ciseaux | Contre le serveur : perdu = éliminé, égalité = on continue. |
| 🃏 | La carte la plus haute | Les cartes les plus basses sont éliminées. |
| 🚪 | Les portes | Une porte (ou plus) est piégée. |
| ⚡ | Réflexe | Cliquer au vert : trop tôt = éliminé, les plus lents aussi. |
| 🚦 | Feu rouge, feu vert | Avancer au vert ; un clic au rouge = éliminé ; les plus avancés passent. |
| 👆 | Course de clics | Le plus de clics en 10 s ; la moitié la plus basse est éliminée. |
| ❓ | Quiz | Mauvaise réponse ou pas de réponse = éliminé. Questions gérées dans l'administration. |
| 💰 | Le juste prix | Estimer le nombre de points d'une image ; les plus éloignés sont éliminés. |
| 🧮 | Calcul mental | Erreur = éliminé ; les plus lents aussi. |
| 🧠 | Mémoire | Séquence de couleurs type Simon qui s'allonge à chaque tour. |
| 🎡 | Roue de la fortune | Le hasard désigne les éliminés de chaque tour. |
| 💎 | Enchères à l'aveugle | Budget de points ; la plus petite mise est éliminée. |

**💬 Chat** : un salon général pour l'alliance sur la page d'accueil et un salon dans chaque salle de jeu
(les éliminés et spectateurs peuvent continuer à parler). Mentions de ton pseudo mises en évidence, anti-flood,
suppression des messages par les R4/R5/admins, et admins qui peuvent rendre un joueur muet quelques minutes.

Chaque jeu a ses paramètres (temps par tour, % d'éliminés, difficulté…) en plus des paramètres communs :
temps par tour, tour suivant automatique ou manuel, durée de l'écran de résultats, nombre de tours max.

**Règles communes** : un joueur qui ne joue pas à temps est éliminé · si tous les joueurs restants sont éliminés au
même tour, le tour est rejoué entre eux · en cas d'égalité finale, mort subite (tirage de 1 à 1000) ·
les éliminés restent en spectateurs · personne ne rejoint une partie lancée (sauf en spectateur).

---

> **Production actuelle** : Render (Francfort) + Neon, déployés automatiquement par la pipeline CI/CD
> (tests → version → déploiement → vérification → retour arrière automatique).
> Tout est expliqué dans **[docs/CICD.md](docs/CICD.md)**. Les sections 2 et 3 ci-dessous décrivent les
> hébergements possibles.

## 1. Lancer en local

Prérequis : **Node.js 20 ou plus** ([nodejs.org](https://nodejs.org)) et une base PostgreSQL.

```bash
cd last_war
npm install
cp .env.example .env          # puis édite .env (voir ci-dessous)
```

**Base de données**, au choix :
- **Docker** (le plus simple) : `docker compose up -d` lance PostgreSQL + Redis ; garde les URL de `.env.example`
  et mets `REDIS_URL="redis://localhost:6379"`.
- **Neon** (gratuit, sans rien installer) : crée un projet sur [neon.tech](https://neon.tech), copie l'URL
  « pooled » dans `DATABASE_URL` et l'URL directe dans `DIRECT_URL`.

Dans `.env`, remplis aussi `JWT_SECRET` (longue chaîne aléatoire) et ton pseudo de super admin :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # pour JWT_SECRET
```

Puis :

```bash
npm run db:migrer        # crée les tables
npm run db:questions     # ajoute ~30 questions de quiz de départ (facultatif)
npm start                # ou « npm run dev » pour relancer à chaque modification
```

Ouvre <http://localhost:3000>, connecte-toi avec `SUPER_ADMIN_PSEUDO` / `SUPER_ADMIN_MOT_DE_PASSE`.

> **Changer le pseudo ou le mot de passe du super admin** : le compte n'est créé qu'au premier démarrage ;
> modifier `.env` ensuite ne suffit pas. Modifie `.env` puis lance **`npm run superadmin`** : le compte est créé
> ou son mot de passe mis à jour, et l'ancien super admin (autre pseudo) est retiré et bloqué.

> **Jouer depuis les téléphones de l'alliance sans déployer** : les autres appareils doivent être sur le même
> réseau Wi-Fi (`http://<ip-de-ton-pc>:3000`), ou utilise un tunnel comme
> `npx cloudflared tunnel --url http://localhost:3000` pour obtenir une adresse publique temporaire.

## 2. Déployer sur Vercel

Vercel accepte les WebSockets dans ses fonctions (Fluid compute, activé par défaut sur les nouveaux projets).
L'application est prête : `api/server.js` + `vercel.json`.

1. Pousse le dossier sur GitHub, puis **Add New → Project** sur Vercel et importe le dépôt.
2. **Storage** (Marketplace) : ajoute **Neon** (PostgreSQL) et **Upstash** (Redis). Vercel crée les variables ;
   vérifie que `DATABASE_URL`, `DIRECT_URL` et `REDIS_URL` existent (renomme-les si besoin).
   **Redis est obligatoire sur Vercel** (plusieurs instances).
3. Ajoute `JWT_SECRET`, `SUPER_ADMIN_PSEUDO`, `SUPER_ADMIN_MOT_DE_PASSE`, `NODE_ENV=production`.
4. Déploie. Le build lance `npm run vercel-build` (Prisma + migrations).
5. Pour ajouter les questions de départ, une fois, depuis ton PC avec les variables de prod :
   `npm run db:questions`.

Une connexion WebSocket est coupée quand la fonction atteint sa durée max (300 s ici) : le navigateur se
reconnecte tout seul en moins d'une seconde et retrouve sa place. Si ça gêne pendant les parties, passe à
Render (ci-dessous) **sans changer le code**.

## 3. Alternative : Render ou Railway (serveur toujours allumé)

Un vrai serveur Node, connexions WebSocket illimitées. Recommandé si les coupures Vercel posent problème.

- **Render** : *New → Blueprint*, choisis le dépôt (`render.yaml` est fourni), puis renseigne `DATABASE_URL`,
  `DIRECT_URL`, `SUPER_ADMIN_PSEUDO`, `SUPER_ADMIN_MOT_DE_PASSE` (et `REDIS_URL` si tu mets plusieurs instances).
  Le plan gratuit s'endort après 15 min sans visite : prends « Starter » pour les soirs de jeu.
- **Railway** : *New Project → Deploy from GitHub*, ajoute un PostgreSQL (et un Redis) depuis Railway,
  mêmes variables, commande de démarrage `npm run db:migrer && npm start`.

**Mixte** (pages sur Vercel, temps réel sur Render) : sur Render `ORIGINES_AUTORISEES=https://ton-site.vercel.app`,
sur Vercel `URL_TEMPS_REEL=https://ton-serveur.onrender.com`. Les deux doivent partager la même base, le même Redis
et le même `JWT_SECRET`.

## 4. Utilisation

1. Chaque membre s'inscrit avec **son pseudo exact dans Last War** et un mot de passe (il devient R1).
2. Le super admin (toi) nomme des admins ; les admins attribuent les rangs **R4/R5** dans *Administration → Comptes*.
3. Un R4/R5/admin va dans *Organiser → Créer une partie*, choisit le mini-jeu et ses paramètres, et partage le code de salle.
4. Les joueurs cliquent sur la partie dans l'accueil puis **Rejoindre la partie**.
5. L'organisateur clique **Lancer** quand tout le monde est là. Il peut forcer la fin d'un tour, lancer le tour
   suivant (mode manuel) ou arrêter la partie.
6. *Historique* : toutes les parties (date, mini-jeu, gagnant) et le classement par victoires.

Mot de passe oublié : un admin le réinitialise depuis *Administration → Comptes* (🔑).

Modération du chat : survole un message (ou touche-le sur téléphone) → ✕ pour le supprimer (R4/R5/admins, ou
l'auteur), 🔇 pour rendre son auteur muet (admins ; 0 minute = lever la sanction).

## 5. Tests

```bash
npm test                                   # tests unitaires des mini-jeux (sans base)
npm run test:integration                   # API, droits et chat (serveur lancé + base)
npm run test:charge                        # 100 joueurs simulés sur les 16 mini-jeux (serveur lancé + base)
npm run test:nettoyer                      # supprime les comptes Bot et leurs parties de test
node tests/charge.js --joueurs 100 --jeu des --url https://ton-site.vercel.app
```

Le test de charge crée des comptes `Bot001…Bot100` et un `BotOrganisateur` (R5) directement en base, puis joue des
parties complètes et affiche latence, nombre de tours, gagnant et vérification de l'enregistrement en base.
**Lance-le sur un environnement de test** (ou supprime ensuite les comptes Bot depuis l'administration).

## 6. Sécurité

- Mots de passe chiffrés avec **bcrypt** ; jamais stockés ni renvoyés en clair.
- Session **JWT en cookie httpOnly** (inaccessible au JavaScript), `secure` en production.
- **Limitation des tentatives** : 10 échecs de connexion / 15 min par IP et pseudo, 100 requêtes / 15 min par IP.
- **Droits vérifiés côté serveur** pour chaque action HTTP et Socket.IO ; un éliminé ne peut plus jouer, une seule action
  par tour, cadence de clics plafonnée, 30 messages/s max par connexion.
- Tirages faits par le serveur (`crypto.randomInt`) ; les informations secrètes (bonne réponse, porte piégée, moment du
  feu vert, nombre de points) ne quittent jamais le serveur avant les résultats.
- Journal des actions d'administration (y compris suppressions de messages et joueurs rendus muets) consultable par le super admin.
- Chat : texte brut échappé à l'affichage (pas de HTML ni de script possible), 200 caractères max, 1 message/s et 6/15 s max.

Limite connue : pour *Réflexe* et *Feu rouge, feu vert*, le temps est mesuré à la réception par le serveur. C'est
impossible à truquer, mais une connexion très lente est légèrement désavantagée.

## 7. Ajouter un mini-jeu

1. Copie `src/minijeux/pile-ou-face/` vers `src/minijeux/mon-jeu/`.
2. Dans `serveur.js` : change `id`, `nom`, `description`, `parametres`, et écris `initialiser`, `debutTour`,
   `action`, `resoudreTour` (interface commentée dans `src/minijeux/index.js`).
3. Dans `client.js` : `LW.miniJeux['mon-jeu'] = { monter, resultat, … }`.
4. Redémarre : le jeu apparaît dans la liste.
5. Tests : ajoute 1 ligne dans `tests/minijeux.test.js` (`donnees`) et 1 dans `tests/strategies.js`
   (détails et exemple : [docs/CICD.md](docs/CICD.md), « Ajouter un mini-jeu : les tests »).

Le moteur (salles, chrono, éliminations, rejeu, mort subite, gagnant, enregistrement) ne change pas.
