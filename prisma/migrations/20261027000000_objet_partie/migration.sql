-- Objet de la partie : ce que le gagnant obtient (Conducteur ou VIP du train) et à quelle date.
-- Migration additive : colonnes optionnelles, les anciennes parties restent sans objet.
CREATE TYPE "ObjetPartie" AS ENUM ('CONDUCTEUR', 'VIP');

ALTER TABLE "parties" ADD COLUMN "objet" "ObjetPartie",
ADD COLUMN "dateObjet" DATE;

CREATE INDEX "parties_objet_statut_dateObjet_idx" ON "parties"("objet", "statut", "dateObjet");
