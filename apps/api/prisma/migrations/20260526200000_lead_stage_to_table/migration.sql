-- Pipeline customizavel (Abordagem B): enum LeadStage vira tabela LeadStage,
-- com slugs preservados pros 6 stages atuais. Lead.stage (enum) vira
-- Lead.stageId (FK). StageConfig (introduzido em 20260526120000) e
-- absorvido pela tabela nova.
--
-- Stages sistemicos sao novo_lead, experimental_agendada e matriculado
-- (codigo escreve nesses slugs). Eles ganham systemic=true e nao podem
-- ser excluidos pela UI.
--
-- Tudo numa migration so pra evitar janela de inconsistencia. Em caso de
-- falha, a transacao do Prisma garante rollback total.

-- 1. Cria o novo enum kind (active / won / lost) — substitui logica
--    hardcoded de "stage=='matriculado' e win, stage=='perdido' e lost".
CREATE TYPE "LeadStageKind" AS ENUM ('active', 'won', 'lost');

-- 2. Renomeia o enum antigo pra liberar o nome "LeadStage" pra tabela nova.
ALTER TYPE "LeadStage" RENAME TO "LeadStage_old";

-- 3. Cria a tabela LeadStage com todos os campos do novo modelo.
CREATE TABLE "LeadStage" (
    "id"         TEXT NOT NULL,
    "slug"       TEXT NOT NULL,
    "label"      TEXT NOT NULL,
    "color"      TEXT,
    "order"      INTEGER NOT NULL,
    "kind"       "LeadStageKind" NOT NULL DEFAULT 'active',
    "systemic"   BOOLEAN NOT NULL DEFAULT false,
    "archived"   BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadStage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadStage_slug_key" ON "LeadStage"("slug");
CREATE UNIQUE INDEX "LeadStage_order_key" ON "LeadStage"("order");

-- 4. Seed dos 6 stages atuais. IDs deterministicos (`seed_<slug>`)
--    facilitam a migration do Lead.stage abaixo. kind derivado do slug.
--    Preserva label/color/order/systemic do StageConfig se existir;
--    fallback pros padroes da fase A.
INSERT INTO "LeadStage" (id, slug, label, color, "order", kind, systemic, archived, "updatedAt")
VALUES
    ('seed_novo_lead',             'novo_lead',             COALESCE((SELECT label FROM "StageConfig" WHERE stage::text = 'novo_lead'),             'Novo lead'),             (SELECT color FROM "StageConfig" WHERE stage::text = 'novo_lead'),             COALESCE((SELECT "order" FROM "StageConfig" WHERE stage::text = 'novo_lead'),             1), 'active'::"LeadStageKind", true,  false, CURRENT_TIMESTAMP),
    ('seed_em_atendimento',        'em_atendimento',        COALESCE((SELECT label FROM "StageConfig" WHERE stage::text = 'em_atendimento'),        'Em atendimento'),        (SELECT color FROM "StageConfig" WHERE stage::text = 'em_atendimento'),        COALESCE((SELECT "order" FROM "StageConfig" WHERE stage::text = 'em_atendimento'),        2), 'active'::"LeadStageKind", false, false, CURRENT_TIMESTAMP),
    ('seed_pre_agendamento',       'pre_agendamento',       COALESCE((SELECT label FROM "StageConfig" WHERE stage::text = 'pre_agendamento'),       'Pre-agendamento'),       (SELECT color FROM "StageConfig" WHERE stage::text = 'pre_agendamento'),       COALESCE((SELECT "order" FROM "StageConfig" WHERE stage::text = 'pre_agendamento'),       3), 'active'::"LeadStageKind", false, false, CURRENT_TIMESTAMP),
    ('seed_experimental_agendada', 'experimental_agendada', COALESCE((SELECT label FROM "StageConfig" WHERE stage::text = 'experimental_agendada'), 'Experimental agendada'), (SELECT color FROM "StageConfig" WHERE stage::text = 'experimental_agendada'), COALESCE((SELECT "order" FROM "StageConfig" WHERE stage::text = 'experimental_agendada'), 4), 'active'::"LeadStageKind", true,  false, CURRENT_TIMESTAMP),
    ('seed_matriculado',           'matriculado',           COALESCE((SELECT label FROM "StageConfig" WHERE stage::text = 'matriculado'),           'Matriculado'),           (SELECT color FROM "StageConfig" WHERE stage::text = 'matriculado'),           COALESCE((SELECT "order" FROM "StageConfig" WHERE stage::text = 'matriculado'),           5), 'won'::"LeadStageKind",    true,  false, CURRENT_TIMESTAMP),
    ('seed_perdido',               'perdido',               COALESCE((SELECT label FROM "StageConfig" WHERE stage::text = 'perdido'),               'Perdido'),               (SELECT color FROM "StageConfig" WHERE stage::text = 'perdido'),               COALESCE((SELECT "order" FROM "StageConfig" WHERE stage::text = 'perdido'),               6), 'lost'::"LeadStageKind",   false, false, CURRENT_TIMESTAMP);

-- 5. Adiciona Lead.stageId (nullable temporariamente pra permitir backfill).
ALTER TABLE "Lead" ADD COLUMN "stageId" TEXT;

-- 6. Backfill: cada lead recebe stageId = seed_<seu stage enum atual>.
UPDATE "Lead" SET "stageId" = 'seed_' || stage::text;

-- 7. Vira NOT NULL agora que todos foram preenchidos.
ALTER TABLE "Lead" ALTER COLUMN "stageId" SET NOT NULL;

-- 8. FK + indice (Prisma espera @@index([stageId]) — o antigo @@index([stage])
--    sai junto com a coluna).
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "LeadStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Lead_stageId_idx" ON "Lead"("stageId");

-- 9. StageConfig foi absorvido pela tabela LeadStage — drop antes do enum
--    porque a coluna `stage` de StageConfig depende do tipo "LeadStage_old".
DROP TABLE "StageConfig";

-- 10. Remove o indice antigo + coluna enum + tipo enum antigo.
DROP INDEX "Lead_stage_idx";
ALTER TABLE "Lead" DROP COLUMN stage;
DROP TYPE "LeadStage_old";
