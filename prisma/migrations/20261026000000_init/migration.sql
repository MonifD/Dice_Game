-- CreateEnum
CREATE TYPE "Role" AS ENUM ('JOUEUR', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "Rang" AS ENUM ('R1', 'R2', 'R3', 'R4', 'R5');

-- CreateEnum
CREATE TYPE "StatutPartie" AS ENUM ('ATTENTE', 'EN_COURS', 'TERMINEE', 'ANNULEE');

-- CreateTable
CREATE TABLE "joueurs" (
    "id" SERIAL NOT NULL,
    "pseudo" TEXT NOT NULL,
    "pseudoNormalise" TEXT NOT NULL,
    "motDePasseHash" TEXT NOT NULL,
    "rang" "Rang" NOT NULL DEFAULT 'R1',
    "role" "Role" NOT NULL DEFAULT 'JOUEUR',
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "dateInscription" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "derniereConnexion" TIMESTAMP(3),

    CONSTRAINT "joueurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "miniJeu" TEXT NOT NULL,
    "parametres" JSONB NOT NULL,
    "statut" "StatutPartie" NOT NULL DEFAULT 'ATTENTE',
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateDebut" TIMESTAMP(3),
    "dateFin" TIMESTAMP(3),
    "nbParticipants" INTEGER NOT NULL DEFAULT 0,
    "nbTours" INTEGER NOT NULL DEFAULT 0,
    "organisateurId" INTEGER NOT NULL,
    "gagnantId" INTEGER,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participations" (
    "id" SERIAL NOT NULL,
    "joueurId" INTEGER NOT NULL,
    "partieId" INTEGER NOT NULL,
    "tourAtteint" INTEGER NOT NULL DEFAULT 0,
    "positionFinale" INTEGER,

    CONSTRAINT "participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions_quiz" (
    "id" SERIAL NOT NULL,
    "categorie" TEXT NOT NULL DEFAULT 'Last War',
    "question" TEXT NOT NULL,
    "choix" TEXT[],
    "bonneReponse" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journaux" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auteurId" INTEGER,
    "action" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "journaux_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "joueurs_pseudo_key" ON "joueurs"("pseudo");

-- CreateIndex
CREATE UNIQUE INDEX "joueurs_pseudoNormalise_key" ON "joueurs"("pseudoNormalise");

-- CreateIndex
CREATE UNIQUE INDEX "parties_code_key" ON "parties"("code");

-- CreateIndex
CREATE INDEX "parties_dateCreation_idx" ON "parties"("dateCreation");

-- CreateIndex
CREATE UNIQUE INDEX "participations_joueurId_partieId_key" ON "participations"("joueurId", "partieId");

-- CreateIndex
CREATE INDEX "journaux_date_idx" ON "journaux"("date");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_organisateurId_fkey" FOREIGN KEY ("organisateurId") REFERENCES "joueurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_gagnantId_fkey" FOREIGN KEY ("gagnantId") REFERENCES "joueurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_joueurId_fkey" FOREIGN KEY ("joueurId") REFERENCES "joueurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_partieId_fkey" FOREIGN KEY ("partieId") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
