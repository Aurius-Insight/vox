-- Minimiza os papeis para diretor, coordenacao e professor (alinhado a
-- transcricao da reuniao). `admin` vira `diretor`; `gestor` e `vendas` saem.

-- Remove dados vinculados a usuarios gestor/vendas antes de trocar o enum.
DELETE FROM "Attendance"
WHERE "markedByUserId" IN (
  SELECT "id" FROM "User" WHERE "roles" && ARRAY['gestor', 'vendas']::"Role"[]
);
DELETE FROM "User" WHERE "roles" && ARRAY['gestor', 'vendas']::"Role"[];

-- Troca o enum Role, renomeando admin -> diretor.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('diretor', 'coordenacao', 'professor');
ALTER TABLE "User"
  ALTER COLUMN "roles" TYPE "Role"[]
  USING (REPLACE("roles"::text, 'admin', 'diretor')::"Role"[]);
DROP TYPE "Role_old";
