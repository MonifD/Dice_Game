-- Loup-Garou (jeu d'équipe) : camp gagnant et noms des gagnants enregistrés avec la partie.
ALTER TABLE "parties" ADD COLUMN "resultat" JSONB;
