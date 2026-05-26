-- Pipeline customizavel (Abordagem A): mantem o enum LeadStage e adiciona
-- configuracao visual (label, cor, ordem, visibilidade) por etapa.
-- Stages sistemicos (newo_lead, matriculado, experimental_agendada) sao
-- protegidos contra archive — codigo escreve neles na conversao/sync.

CREATE TABLE "StageConfig" (
    "stage"     "LeadStage"  PRIMARY KEY,
    "label"     TEXT         NOT NULL,
    "color"     TEXT,
    "order"     INTEGER      NOT NULL,
    "visible"   BOOLEAN      NOT NULL DEFAULT true,
    "systemic"  BOOLEAN      NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "StageConfig_order_key" ON "StageConfig"("order");

-- Seed com os 6 stages atuais, na ordem usada no front (LEAD_STAGES de types.ts).
-- Sistemicos = codigo do app escreve neles e mapping do BotConversa depende:
--   - novo_lead             (webhook + sync criam aqui)
--   - experimental_agendada (convert lead -> aluno experimental escreve)
--   - matriculado           (convert lead -> aluno matriculado escreve)
INSERT INTO "StageConfig" ("stage", "label", "order", "visible", "systemic", "updatedAt") VALUES
    ('novo_lead',             'Novo lead',             1, true, true,  CURRENT_TIMESTAMP),
    ('em_atendimento',        'Em atendimento',        2, true, false, CURRENT_TIMESTAMP),
    ('pre_agendamento',       'Pre-agendamento',       3, true, false, CURRENT_TIMESTAMP),
    ('experimental_agendada', 'Experimental agendada', 4, true, true,  CURRENT_TIMESTAMP),
    ('matriculado',           'Matriculado',           5, true, true,  CURRENT_TIMESTAMP),
    ('perdido',               'Perdido',               6, true, false, CURRENT_TIMESTAMP);
