-- Schema additions decorrentes das decisoes de absorcao das planilhas:
--   * Student.tags  — modalidades extras nao-padrao (MENSALISTA, MIX, ATO,
--                     ADVOGADO, EXP-equivalentes) capturadas das planilhas
--                     ou do app, sem alterar o type. Lista livre.
--   * Subject.description — texto descritivo da disciplina (vindo das
--                     imagens oficiais que o cliente enviou).
--
-- Seeds inline:
--   * Renomeia "Comunicacao Criativa" -> "Comunicacao Criativa e Improvisacao"
--   * Cria 2 disciplinas oficiais que faltavam: Pedagogias da Voz,
--     Performance da Palavra.
--   * Grava as 5 descricoes oficiais (decisao 11).
--   * Arquiva "Oratoria e Argumentacao" (sem prof / sem aula vinculados).
--   * Reativa unidade "Niteroi" como unidade de triagem dos 242 alunos
--     da planilha CONTROLE NITEROI (decisao 8 — operador refina pra
--     Icarai/Santa Rosa caso a caso depois).

-- 1) Schema
ALTER TABLE "Student"  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Subject"  ADD COLUMN "description" TEXT;

-- 2) Renomeia Comunicacao Criativa
UPDATE "Subject"
SET name = 'Comunicacao Criativa e Improvisacao'
WHERE name = 'Comunicacao Criativa';

-- 3) Cria 2 disciplinas oficiais que faltavam
INSERT INTO "Subject" (id, name, active, "createdAt", "updatedAt")
VALUES
  ('subj_pedagogias_voz',      'Pedagogias da Voz',      true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('subj_performance_palavra', 'Performance da Palavra', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 4) Descricoes oficiais (decisao 11)
UPDATE "Subject" SET description = 'Libere seu corpo. Libere sua fala. Voce fala com o corpo antes mesmo de abrir a boca. Aqui, voce ativa sua presenca e aprende a ocupar o espaco com seguranca e potencia. Sua comunicacao comeca no corpo — e o corpo nao mente.'
WHERE name = 'Expressao Corporal';

UPDATE "Subject" SET description = 'Potencia, ritmo, clareza. A voz que te representa. Voce aprende a dominar sua respiracao, projecao e impostacao vocal. Descobre como sua voz pode ser seu maior instrumento de autoridade — sem esforco, sem formulas.'
WHERE name = 'Pedagogias da Voz';

UPDATE "Subject" SET description = 'Quem ouve com atencao, fala com precisao. Voce desenvolve escuta ativa e presenca relacional. Aprende a se conectar de verdade com o outro — e a responder com impacto, mesmo no silencio.'
WHERE name = 'Pedagogias da Escuta';

UPDATE "Subject" SET description = 'Solte o controle. Desbloqueie o improviso. Aqui voce para de travar. Aprende a pensar em voz alta, improvisar com clareza e falar com fluidez em qualquer situacao. Uma aula que vira um desbloqueio completo.'
WHERE name = 'Comunicacao Criativa e Improvisacao';

UPDATE "Subject" SET description = 'Falar e uma arte — e voce vai aprender a performar com verdade. A entonacao certa, o ritmo que prende, a pausa que impacta. Voce lapida sua fala como ferramenta de emocao, influencia e presenca real.'
WHERE name = 'Performance da Palavra';

-- 5) Arquiva matéria sem uso (sem professor / sem ClassSession vinculados)
UPDATE "Subject" SET active = false
WHERE name = 'Oratoria e Argumentacao';

-- 6) Reativa unidade Niteroi como unidade de triagem do import legado.
--    Operador refina Lead/Student pra Icarai ou Santa Rosa caso a caso
--    depois pela UI de /unidades + edicao de aluno. Reversivel.
UPDATE "Unit" SET active = true WHERE name = 'Niterói';
