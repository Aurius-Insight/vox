# Plano — Pipeline (etapas) customizavel

> Rascunho discutido em 2026-05-26. Nao implementado ainda. Objetivo:
> permitir que diretor/coordenacao adicione, edite, oculte ou exclua
> etapas do Kanban de Vendas sem precisar de deploy.

## Status atual

`LeadStage` e um **enum hardcoded** no Postgres com 6 valores fixos:

```
novo_lead | em_atendimento | pre_agendamento | experimental_agendada | matriculado | perdido
```

Mexer nas etapas hoje exige migration + deploy. Coordenacao nao tem
autonomia.

### 12 pontos de acoplamento (mapa do impacto)

| # | Arquivo | Acoplamento |
|---|---|---|
| 1 | `prisma/schema.prisma` | `enum LeadStage` + `Lead.stage` + `@@index([stage])` |
| 2 | `apps/web/src/api/types.ts` | `LEAD_STAGES` (ordem) + `LEAD_STAGE_LABELS` (textos) |
| 3 | `LeadsPage.tsx` | Renderiza colunas do Kanban a partir de `LEAD_STAGES` |
| 4 | `routes/leads.ts` | Schema Zod com enum + endpoint `PATCH /api/leads/:id/stage` |
| 5 | `routes/leads.ts` (convert) | Escreve `stage='matriculado'` / `'experimental_agendada'` |
| 6 | `routes/dashboard.ts` | Query `count where stage='matriculado'` + `groupBy stage` |
| 7 | `routes/webhooks.ts` | Cria lead novo com `stage: 'novo_lead'` |
| 8 | `routes/students.ts` | Le `lead.stage` ao montar origem do aluno |
| 9 | `lib/botconversa-mapping.ts` | `TAG_STAGE_RULES` — regex → stage hardcoded |
| 10 | `lib/botconversa-sync.ts` | `deriveStage()`, condiciona update `existingLead.stage === 'novo_lead'` |
| 11 | `domain/enrollment.ts` | `canConvertLead` |
| 12 | `AuditLog` (dados) | Grava `before/after` com strings de stage — pode ter referencias a stages futuros excluidos |

## Decisao de design: o que acontece com os leads ao ocultar/excluir

**Decisao confirmada:** toda operacao de **ocultar** ou **excluir** uma
etapa que tenha leads dentro deve **forcar a escolha de uma etapa de
destino** pros leads existentes.

Sem essa escolha, a operacao e bloqueada. **Nunca ha lead orfao.**

### Fluxo UX

```
Usuario clica "Arquivar etapa: Pre-agendamento"
       │
       ▼
Sistema verifica leads na etapa
       │
       ├── 0 leads: arquiva direto, sem modal.
       │
       └── N leads: abre modal
                   ┌──────────────────────────────────────────┐
                   │ Arquivar "Pre-agendamento"                │
                   │                                          │
                   │ Esta etapa tem 12 leads.                 │
                   │ Mover esses leads para:                  │
                   │                                          │
                   │   [ Selecione uma etapa... ▼ ]           │
                   │      - Novo lead                         │
                   │      - Em atendimento                    │
                   │      - Experimental agendada             │
                   │      - Matriculado                       │
                   │      - Perdido                           │
                   │      (a etapa atual fica de fora)        │
                   │                                          │
                   │ [Cancelar]   [Mover 12 leads e arquivar] │
                   └──────────────────────────────────────────┘
                                 │
                                 ▼
                   Transacao no DB:
                   1. UPDATE Lead SET stage = <destino>
                      WHERE stage = <origem>
                   2. UPDATE LeadStage SET archived = true
                      WHERE id = <origem>      (Abordagem B)
                      OU
                      UPDATE StageConfig SET visible = false
                      WHERE stage = <origem>   (Abordagem A)
                   3. INSERT AuditLog
                      action: 'stage.archived'
                      before: { stage, leadCount, fromStage }
                      after: { archived: true, movedTo: <destino> }
```

A mesma UX vale pra **excluir definitivamente** (so disponivel em B,
sobre etapa ja arquivada): o modal aparece se houver leads, pede destino,
move e deleta.

### Invariantes

| Invariante | Garantia |
|---|---|
| Nenhum lead fica sem stage valido | Transacao envolve update do Lead antes do archive/delete |
| Operacao e idempotente em re-tentativa | Move so o que ainda tem aquela origem; safe pra retry |
| Stage sistemico (`novo_lead`, `matriculado`, `experimental_agendada`, `perdido`) nao e excluivel | Validacao no endpoint; UI nao oferece a opcao |
| Re-sync do BotConversa nao quebra | Stages sistemicos sao protegidos; mapping em `botconversa-mapping.ts` usa slugs fixos que continuam existindo |
| Dashboard "taxa de conversao" continua funcionando | Stages sistemicos com `kind: 'won' \| 'lost'` na tabela; dashboard filtra por kind, nao por slug literal (Abordagem B) — em A, simplesmente nao deixa arquivar stage 'matriculado' |
| Audit trail preservado | AuditLog grava operacao + leadCount + destino |

## Duas abordagens

### Abordagem A — "leve" (mantem enum, customiza apresentacao)

Usuario configura:
- Ordem das colunas
- Texto exibido (label) de cada coluna
- Cor de cada coluna
- **Visibilidade** (oculta no Kanban)

Usuario **nao** cria etapa nova (precisa de dev + migration).

#### Tabela nova: `StageConfig`

```prisma
model StageConfig {
  stage     LeadStage @id   // FK no enum
  label     String
  color     String?          // hex tipo "#f97316"
  order     Int       @unique
  visible   Boolean   @default(true)
  systemic  Boolean   @default(false)  // novo_lead, matriculado, etc — nao excluivel
  updatedAt DateTime  @updatedAt
}
```

#### Endpoints
- `GET /api/stages/config` — lista config atual ordenada
- `PATCH /api/stages/config/:stage` — atualiza label/color/order/visible
- `POST /api/stages/config/:stage/archive` — body `{ moveLeadsTo: LeadStage }`. Roda o fluxo UX descrito acima.
- `POST /api/stages/config/:stage/restore` — desfaz archive (visible=true).

#### Custo
~1-2 dias dev. Risco baixo. Limite: nao cria etapa nova.

### Abordagem B — "real" (migra enum → tabela)

`LeadStage` deixa de ser enum. Vira tabela `LeadStage`. `Lead.stage` vira FK (`Lead.stageId`).

Usuario cria/edita/arquiva/exclui etapas livremente, exceto sistemicas.

#### Schema novo

```prisma
model LeadStage {
  id        String   @id @default(cuid())
  slug      String   @unique     // novo_lead, matriculado, em_negociacao_avancada, etc
  label     String
  color     String?
  order     Int      @unique
  kind      StageKind            // active | won | lost
  systemic  Boolean  @default(false)
  archived  Boolean  @default(false)
  archivedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  leads     Lead[]
}

enum StageKind {
  active   // qualquer etapa do meio do funil
  won      // matriculado — sucesso
  lost     // perdido — saiu do funil
}

model Lead {
  // ...
  stageId String
  stage   LeadStage @relation(fields: [stageId], references: [id])
  // ...
}
```

#### Endpoints
- `GET /api/stages` — lista ativas
- `GET /api/stages?archived=true` — inclui arquivadas
- `POST /api/stages` — cria nova (`{ label, color, kind: 'active' }`)
- `PATCH /api/stages/:id` — atualiza label, color, order
- `POST /api/stages/:id/archive` — body `{ moveLeadsTo: stageId }`
- `POST /api/stages/:id/restore` — desfaz archive
- `DELETE /api/stages/:id` — so se `archived=true` e sem leads. Body `{ moveLeadsTo?: stageId }` caso ainda tenha leads (fallback).

#### Migracao de dados (D-0)

```sql
-- 1. cria tabela LeadStage
-- 2. seeda os 6 stages atuais como systemic=true, com slug igual ao enum
INSERT INTO "LeadStage"(id, slug, label, order, kind, systemic) VALUES
  ('seed_novo_lead',             'novo_lead',             'Novo lead',             1, 'active', true),
  ('seed_em_atendimento',        'em_atendimento',        'Em atendimento',        2, 'active', true),
  ('seed_pre_agendamento',       'pre_agendamento',       'Pre-agendamento',       3, 'active', true),
  ('seed_experimental_agendada', 'experimental_agendada', 'Experimental agendada', 4, 'active', true),
  ('seed_matriculado',           'matriculado',           'Matriculado',           5, 'won',    true),
  ('seed_perdido',               'perdido',               'Perdido',               6, 'lost',   true);

-- 3. adiciona Lead.stageId, mapeia do enum atual
ALTER TABLE "Lead" ADD COLUMN "stageId" TEXT;
UPDATE "Lead" SET "stageId" = 'seed_' || "stage"::text;
ALTER TABLE "Lead" ALTER COLUMN "stageId" SET NOT NULL;
ALTER TABLE "Lead" ADD CONSTRAINT lead_stage_fk
  FOREIGN KEY ("stageId") REFERENCES "LeadStage"(id);

-- 4. dropa Lead.stage (enum antigo). DROP TYPE em migration seguinte
-- depois de garantir que nada usa.
```

Migration nao destrutiva no curto prazo — mantem coluna `stage` (enum)
por uma deploy pra rollback rapido; remove em migration seguinte quando
tudo estiver estavel.

#### Pontos de codigo que mudam (mapeamento dos 12)

| # | Mudanca |
|---|---|
| 4 | Zod enum vira `z.string()` validado contra DB. Endpoint `PATCH /leads/:id/stage` recebe `stageId` |
| 5 | Convert vira `stageId = (await prisma.leadStage.findUnique({ where: { slug: 'matriculado' } })).id` |
| 6 | Dashboard filtra `where: { stage: { kind: 'won' } }` em vez de slug literal |
| 7 | Webhook cria com `stageId` do slug `novo_lead` (resolve via cache) |
| 8 | Students le `lead.stage.slug` (relacao) |
| 9 | `TAG_STAGE_RULES` resolve slug → stageId via lookup. Slugs sistemicos preservados, regra nao quebra |
| 10 | `deriveStage()` continua retornando slug; sync resolve pra stageId no momento do upsert |
| 11 | `canConvertLead` continua usando slug |
| 12 | AuditLog continua gravando slug — historico preservado mesmo apos rename/archive |

Frontend (LeadsPage):
- `LEAD_STAGES` deixa de ser const local — vem de `GET /api/stages`
- Componente nova: `<StagesManager>` (CRUD de etapas via modal)
- KanbanColumn aceita stage dinamico

#### Custo
~3-5 dias dev. Risco medio. Migration cuidadosa.

## Gaps comuns (independente da abordagem)

| Gap | Mitigacao |
|---|---|
| Operacao concorrente — A renomeia, B move card | Otimistic update + revalidate ao receber 409 |
| Stage sistemico excluido por erro | `systemic: true` bloqueia archive/delete na API e oculta opcao na UI |
| BotConversa sync grava lead com stage que foi arquivado | Stages sistemicos sao referencia obrigatoria. Stages custom nao sao alvos do mapping atual — sync nunca aponta pra um custom |
| Dashboard quebrando | Filtros por `kind` (won/lost) em B, ou hardcode evitando archive de matriculado em A |
| Ordem desordenada apos drag-drop | Endpoint dedicado `PATCH /api/stages/reorder` recebe lista completa com nova ordem; transacao bulk |
| Leads perdidos em race condition de archive | Transacao no archive (move + flag) — nao deixa janela |
| Audit trail apontando pra stage que nao existe mais | Audit grava slug (string), nao FK — historico legivel mesmo apos delete real |

## Fases de implementacao

### Recomendacao: comecar pela Abordagem A

Entrega valor visivel em 1-2 dias com risco baixo. Migrar pra B so se
houver demanda real de criar etapa nova (que A nao cobre).

### Fase P1 — Abordagem A (config visual)

1. Migration: tabela `StageConfig` + seed com os 6 stages atuais.
2. Endpoints CRUD de config + endpoint de archive com `moveLeadsTo`.
3. UI:
   - Tela `/configuracoes/pipeline` (so diretor): lista etapas, ordena (drag), edita label/cor, toggle visivel.
   - Modal de archive com selecao de destino quando ha leads.
4. LeadsPage le `LEAD_STAGES` da API em vez do const local.
5. Audit log das mudancas.

### Fase P2 — Abordagem B (so se P1 nao bastar)

1. Migration de schema (tabela + FK + seed sistemicos + mapeamento Lead → stageId).
2. Refactor dos 12 pontos de codigo (mapa acima).
3. UI de CRUD de etapa.
4. Migration de remocao do enum antigo (deploy seguinte ao estabilizar).

## Decisoes que travam

1. **Caso de uso real:** que etapa voce sente falta hoje? Se a resposta
   for "nenhuma especifica, so quero ordenar/renomear", **A basta**.
   Se for "Aguardando pagamento", "Negociacao avancada", "Pre-matricula
   ATO", **precisa de B**.
2. **Permissao:** so diretor ou coordenacao tambem? (Provavel: so diretor
   pra customizar; coordenacao usa.)
3. **Cor por etapa:** entra na fase 1 ou fica pra depois? (Custo
   adicional: ~30 min UI.)
4. **Ordenacao por drag-drop entre etapas vs editor de pipeline:** o
   editor entra na tela `/configuracoes/pipeline` ou direto no Kanban?

## Quando voltar

Retomar pela secao **"Decisoes que travam"**. Tendo (1) respondida, esta
claro se vai A ou B. (2), (3), (4) sao detalhes que so importam ao
comecar a UI.

**Recomendacao de execucao:** A se aceitavel; B so com caso de uso
concreto.
