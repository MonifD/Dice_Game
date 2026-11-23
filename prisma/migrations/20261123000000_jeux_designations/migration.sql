-- Page « Jeux », option « Pour s'amuser », désignations Conducteur / VIP par jour, gestion des comptes.
-- Migration additive : rien n'est supprimé.

-- 1. Nouvel objet de partie « Pour s'amuser »
ALTER TYPE "ObjetPartie" ADD VALUE IF NOT EXISTS 'AMUSEMENT';

-- 2. Comptes : mot de passe temporaire, suppression « douce » (la ligne reste pour l'historique)
ALTER TABLE "joueurs" ADD COLUMN "doitChangerMdp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "supprimeLe" TIMESTAMP(3),
ADD COLUMN "pseudoSupprime" TEXT;

-- anciens comptes supprimés (pseudo « [supprimé #id] ») : marqués comme supprimés
UPDATE "joueurs" SET "supprimeLe" = CURRENT_TIMESTAMP WHERE "pseudo" LIKE '[supprimé #%]' AND "supprimeLe" IS NULL;

-- 3. Désignations
CREATE TYPE "ModeDesignation" AS ENUM ('PARTIE', 'MANUELLE', 'SUPPRESSION');

CREATE TABLE "designations" (
    "id" SERIAL NOT NULL,
    "objet" "ObjetPartie" NOT NULL,
    "jour" DATE NOT NULL,
    "joueurId" INTEGER,
    "mode" "ModeDesignation" NOT NULL,
    "partieId" INTEGER,
    "auteurId" INTEGER,
    "ancienPseudo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remplaceeLe" TIMESTAMP(3),
    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "designations_objet_jour_active_idx" ON "designations"("objet", "jour", "active");
CREATE INDEX "designations_jour_idx" ON "designations"("jour");
ALTER TABLE "designations" ADD CONSTRAINT "designations_joueurId_fkey" FOREIGN KEY ("joueurId") REFERENCES "joueurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Reprise des parties déjà jouées : pour chaque (objet, jour), le gagnant de la DERNIÈRE partie terminée
--    est la désignation active ; les précédents sont marqués « remplacé ».
INSERT INTO "designations" ("objet", "jour", "joueurId", "mode", "partieId", "active", "creeLe", "remplaceeLe")
SELECT p."objet", p."dateObjet", p."gagnantId", 'PARTIE', p."id",
       ROW_NUMBER() OVER w = 1,
       COALESCE(p."dateFin", p."dateCreation"),
       CASE WHEN ROW_NUMBER() OVER w = 1 THEN NULL ELSE LAG(COALESCE(p."dateFin", p."dateCreation")) OVER (PARTITION BY p."objet", p."dateObjet" ORDER BY COALESCE(p."dateFin", p."dateCreation") DESC, p."id" DESC) END
FROM "parties" p
WHERE p."statut" = 'TERMINEE' AND p."gagnantId" IS NOT NULL AND p."objet" IS NOT NULL AND p."dateObjet" IS NOT NULL
WINDOW w AS (PARTITION BY p."objet", p."dateObjet" ORDER BY COALESCE(p."dateFin", p."dateCreation") DESC, p."id" DESC);
