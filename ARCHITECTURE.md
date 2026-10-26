# Architecture — Last War Arène

## Vue d'ensemble

```
 Navigateurs (téléphone / PC)                      Serveur Node.js (1 ou plusieurs instances)
 ┌──────────────────────────┐  HTTPS (REST)  ┌───────────────────────────────────────────┐
 │ pages HTML + JS (public/)│ ─────────────▶ │ Express : /api/auth, /api/admin, /api/...  │──▶ PostgreSQL (Prisma)
 │                          │  WebSocket     │ Socket.IO (adaptateur Redis)               │     joueurs, parties,
 │ /minijeux/<id>/client.js │ ◀────────────▶ │ Moteur de partie ── modules mini-jeux      │     participations, quiz
 └──────────────────────────┘                └───────────────────────────────────────────┘
                                                        │ état des salles, verrous, pub/sub
                                                        ▼
                                                      Redis (Upstash)
```

* **PostgreSQL** garde ce qui doit durer : comptes, parties, participations, questions du quiz, journal.
* **Redis** garde l'état *vivant* des salles (joueurs en jeu, tour en cours, actions) et relaie les messages
  Socket.IO entre instances. Sans `REDIS_URL`, un stockage mémoire équivalent est utilisé (une seule instance).
* **Tous les tirages au sort** (dé, pièce, cartes, portes, nombres…) sont faits par le serveur avec `crypto.randomInt`.

## Dossiers

```
last_war/
├── .github/
│   ├── workflows/             CI/CD : tests, PR (fusion auto), livraison, retour de version, sauvegardes
│   └── pull_request_template.md
├── api/server.js              entrée Vercel (exporte le serveur HTTP)
├── prisma/
│   ├── schema.prisma          tables
│   ├── migrations/            migrations SQL
│   └── seed.js                questions de quiz de départ
├── public/                    pages (HTML/CSS/JS sans build)
│   ├── index.html             connexion / inscription
│   ├── accueil.html           parties ouvertes, mes victoires
│   ├── salle.html             salle de jeu (attente, tour, résultats, gagnant)
│   ├── historique.html        historique + classement
│   ├── admin.html             création de partie, comptes & rangs, quiz, journaux
│   ├── css/style.css
│   └── js/ commun.js (API, session, socket) · salle.js (moteur d'affichage) · ui-jeux.js (composants) · chat.js
├── src/
│   ├── serveur.js             HTTP + Express + Socket.IO (npm start)
│   ├── app.js                 Express : routes, fichiers statiques, erreurs
│   ├── config.js              variables d'environnement
│   ├── db/  prisma.js · stockage.js (Redis ou mémoire + verrous)
│   ├── middleware/auth.js     connexion obligatoire, droits
│   ├── routes/  auth.js · parties.js · admin.js
│   ├── services/ authService.js · permissions.js · journal.js · chatService.js
│   ├── socket/index.js        événements temps réel
│   ├── moteur/
│   │   ├── moteur.js          ★ moteur de partie commun
│   │   ├── parametres.js      paramètres communs + validation
│   │   ├── departage.js       mort subite (+ departage.client.js)
│   │   └── outils.js          rng sécurisé, ErreurJeu, garderMeilleurs()
│   └── minijeux/
│       ├── index.js           registre (charge automatiquement chaque dossier)
│       └── <id>/serveur.js + client.js   un dossier par mini-jeu
├── scripts/ci/                version.js (calcul de version) · attendre-calme.js · verifier-prod.js
├── docs/CICD.md               mode d'emploi de la pipeline
└── tests/  minijeux.test.js (unitaires) · integration/ (API, droits, chat)
            charge.js + strategies.js (100 joueurs simulés) · nettoyer-bots.js
```

## Tables (Prisma)

| Table | Champs principaux |
|---|---|
| `joueurs` | pseudo (unique), pseudoNormalise (unique, insensible à la casse), motDePasseHash (bcrypt), rang R1–R5 (R1 par défaut), rôle JOUEUR/ADMIN/SUPER_ADMIN, actif, dateInscription, derniereConnexion |
| `parties` | code de salle, miniJeu, parametres (JSON), statut ATTENTE/EN_COURS/TERMINEE/ANNULEE, dates, organisateur, nbParticipants, nbTours, gagnant |
| `participations` | joueur, partie, tourAtteint, positionFinale (1 = gagnant, ex aequo partagés) |
| `questions_quiz` | catégorie, question, choix[], bonneReponse, active |
| `journaux` | date, auteur, action, détails (rangs, blocages, suppressions…) |

## Rôles et droits (vérifiés côté serveur : `src/services/permissions.js`)

| | R1–R3 | R4–R5 | Admin | Super admin |
|---|:-:|:-:|:-:|:-:|
| Jouer, regarder | ✅ | ✅ | ✅ | ✅ |
| Créer / lancer / faire avancer / arrêter une partie | | ✅ | ✅ | ✅ |
| Rangs, bloquer, supprimer, mot de passe oublié, questions du quiz | | | ✅ | ✅ |
| Nommer des admins, journaux | | | | ✅ |

Un admin ne peut pas modifier un autre admin ; personne ne peut modifier le super admin ni son propre compte
depuis l'administration. Un compte bloqué est déconnecté immédiatement.

## Échanges Socket.IO

Connexion : `transports: ['websocket']`, chemin `/api/socket.io`, jeton JWT dans `auth.token` (ou cookie).
Chaque message client reçoit une réponse `{ ok: true, ... }` ou `{ ok: false, erreur }`.

| Client → serveur | Données | Qui | Effet |
|---|---|---|---|
| `salle:observer` | `{ code }` | tous | rejoint la salle, reçoit l'état complet (sert aussi à la reconnexion) |
| `salle:inscrire` | `{ code }` | tous | s'inscrit en salle d'attente (refusé une fois lancée) |
| `salle:quitter` | `{ code }` | inscrit | quitte la salle d'attente |
| `salle:exclure` | `{ code, joueurId }` | R4/R5/admin | retire quelqu'un de la salle d'attente |
| `salle:lancer` | `{ code }` | R4/R5/admin | lance la partie (≥ 2 joueurs) |
| `salle:suivant` | `{ code }` | R4/R5/admin | termine le tour en cours, ou lance le suivant |
| `salle:arreter` | `{ code }` | R4/R5/admin | arrête la partie (enregistrée sans gagnant) |
| `jeu:action` | `{ code, donnees }` | joueur en jeu | joue son coup (une seule action par tour, sauf jeux de clics) |
| `accueil:suivre` | – | tous | reçoit `salles:maj` quand la liste change |
| `chat:rejoindre` | `{ canal }` | tous | `general` ou `salle:<code>` ; renvoie les 100 derniers messages |
| `chat:quitter` | `{ canal }` | tous | ne plus recevoir ce salon |
| `chat:envoyer` | `{ canal, texte }` | tous (sauf muets) | 200 caractères max, anti-flood 1/s et 6/15 s |
| `chat:supprimer` | `{ canal, id }` | auteur, R4/R5/admin | supprime un message |
| `chat:muet` | `{ joueurId, minutes }` | admin | rend muet (0 = lever) |

| Serveur → client | Données |
|---|---|
| `salle:etat` | état complet de la salle (à chaque changement de phase) |
| `salle:inscription` / `salle:desinscription` | `{ id, pseudo, nb }` en salle d'attente |
| `jeu:aAgi` | `{ tour, essai, joueurId, pseudo, fini, public }` — ex. résultat du dé en direct |
| `jeu:evenement` | `{ tour, essai, type, donnees }` — ex. feu vert, flash de couleur |
| `salles:maj` | la liste des salles a changé |
| `chat:message` | `{ id, canal, auteur: { id, pseudo, rang, role }, texte, date }` |
| `chat:supprime` | `{ canal, id }` |
| `chat:muet` | `{ muetMs }` — envoyé au joueur sanctionné |

### Chat

Deux types de salons : **général** (page d'accueil) et **un par salle** (joueurs, éliminés et spectateurs).
Les 100 derniers messages par salon sont gardés dans Redis (24 h pour le général, 12 h pour une salle) ;
ils ne sont pas archivés en base. Le texte est stocké brut et échappé à l'affichage. Code : `src/services/chatService.js`
et `public/js/chat.js` (widget réutilisable `LW.chat.monter(conteneur, canal)`).

## Le moteur de partie (`src/moteur/moteur.js`)

Phases d'une salle : `attente → tour → resultats → tour → … → termine`.

1. **Création** (HTTP) : paramètres validés, ligne `parties`, état Redis `salle:<code>`.
2. **Lancement** : `initialiser()` du mini-jeu, participations créées, tour 1.
3. **Tour** : `debutTour()` donne la consigne publique et d'éventuels événements programmés.
   Les actions sont stockées dans un hash Redis par tour (sans verrouiller toute la salle : 100 joueurs
   peuvent jouer en même temps). Le tour se termine quand tout le monde a fini **ou** au chrono (+0,6 s de tolérance réseau).
4. **Résolution** (sous verrou, une seule instance) : `resoudreTour()` du mini-jeu, puis règles communes :
   * absent (n'a pas joué) = éliminé ;
   * plus aucun survivant → **le tour est rejoué** entre les mêmes joueurs (l'état du jeu est restauré) ;
   * 5 rejeux d'affilée, `toursMax` atteint, ou mini-jeu épuisé (`estTermine`) avec plusieurs survivants → **mort subite** ;
   * un seul survivant → **gagnant**, enregistrement en base (gagnant, positions, tours atteints).
5. **Résultats** : écran commun + détails du mini-jeu, puis tour suivant automatique (ou manuel).

**Multi-instances** : chaque transition prend un verrou Redis (`SET NX PX`) ; chaque instance vérifie
les échéances toutes les secondes, donc si l'instance qui gérait un tour disparaît, une autre prend le relais.
Les messages passent par l'adaptateur Redis de Socket.IO. Un joueur qui se reconnecte (autre instance,
réseau coupé, fin de durée max d'une fonction Vercel) renvoie `salle:observer` et retrouve son état exact.

## Versions et déploiement

Versions `vX.Y.Z` = tags Git créés par la pipeline (`.github/workflows/livraison.yml`) à partir des titres de PR
(Conventional Commits). Render suit la branche `production`, que seule la pipeline met à jour après les tests ;
revenir à une version = repointer `production` sur un ancien tag. `GET /api/sante` renvoie la version en ligne
et le nombre de parties en cours (la pipeline ne déploie pas pendant une partie). Détails : `docs/CICD.md`.

## Ajouter un mini-jeu

Créer `src/minijeux/mon-jeu/serveur.js` et `client.js` — rien d'autre à modifier. Interface détaillée en tête de
`src/minijeux/index.js` ; le plus simple est de copier `pile-ou-face/`.
