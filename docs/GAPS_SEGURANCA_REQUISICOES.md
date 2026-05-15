# Gaps de Seguranca, Rate Limit e Otimizacao de Requisicoes

## 1. Too many requests

### Risco

Sem limite de requisicoes, o sistema fica vulneravel a:

- Tentativa de senha por forca bruta.
- Abuso de envio de link magico.
- Flood em webhook do BotConversa.
- Scraping de leads/alunos.
- Custo alto com futuras chamadas de IA ou APIs externas.

### Mitigacao criada no scaffold

Arquivo: `apps/api/src/middleware/rateLimit.ts`

Limites iniciais:

| Area | Janela | Limite | Motivo |
|---|---:|---:|---|
| API geral | 1 minuto | 300 req | Evitar abuso geral sem atrapalhar uso interno. |
| Auth | 15 minutos | 20 req | Reduzir tentativa de senha. |
| Portal do aluno | 15 minutos | 30 req | Reduzir abuso de link magico. |
| Webhook | 1 minuto | 120 req | Evitar flood de integracao. |

Quando excede, a API responde `429` com:

```json
{
  "error": {
    "code": "too_many_requests",
    "message": "Muitas requisicoes. Tente novamente em instantes."
  }
}
```

### Gaps ainda abertos

- O rate limit ja usa Redis (`apps/api/src/db/redis.ts`), entao funciona com mais de
  uma instancia. Falta apenas tunar limites em producao.
- Falta rate limit por usuario + IP + rota, com pesos diferentes por endpoint.
- Falta bloqueio temporario por muitas falhas de login no mesmo e-mail.
- Falta monitoramento de picos por IP, origem e endpoint.

## 2. Otimizacao de requisicoes

### Risco

Chamadas mal desenhadas podem gerar lentidao, custos e vazamento de dados por excesso de payload.

Exemplos de problema:

- Tela de dashboard buscando listas inteiras para calcular numeros no frontend.
- Pipeline carregando todos os leads de uma vez.
- Portal do aluno recebendo dados internos desnecessarios.
- Chamada de presenca retornando CPF/WhatsApp completos sem necessidade.
- Requisicoes repetidas por componente sem cache ou consolidacao.

### Mitigacao criada no scaffold

- `GET /api/dashboard` retorna indicadores agregados, nao listas completas.
- `GET /api/leads` tem paginacao por `page` e `pageSize`, limitado a 100.
- `GET /api/classes` retorna dados mascarados para presenca.
- `GET /api/portal/me` retorna somente dados do proprio aluno.
- `GET /api/portal/classes` retorna somente aulas necessarias para o portal.
- Frontend usa uma camada unica em `apps/web/src/api/client.ts`.

### Gaps ainda abertos

- Adicionar cache HTTP com `ETag` para dashboard e listas pouco mutaveis.
- Adicionar debounce em buscas de leads/alunos.
- Adicionar filtros server-side por unidade, etapa, campanha, periodo e responsavel.
- Adicionar indices no banco para campos de filtro.
- Adicionar pagina por cursor em listas grandes.
- Adicionar endpoint especifico de detalhes para evitar payload grande na listagem.

## 3. Endpoints sem seguranca

### Risco

Endpoints administrativos abertos podem expor leads, alunos, presenca, campanhas e saldo de creditos.

Rotas que nunca podem ficar publicas:

- Dashboard.
- CRM/leads.
- Alunos.
- Agenda interna.
- Presenca.
- Configuracoes.
- Pacotes e precos.
- Usuarios e permissoes.
- Eventos de integracao.
- Auditoria.

### Mitigacao criada no scaffold

O backend usa:

- `requireAuth` para exigir login interno.
- `requireRole` para limitar por papel.
- `requirePortalStudent` para isolar portal do aluno.
- Webhook com segredo em header `X-VOX-Webhook-Secret`.

Mapa inicial:

| Endpoint | Protecao |
|---|---|
| `GET /api/dashboard` | diretor |
| `GET /api/leads` | diretor, coordenacao |
| `POST /api/leads` | diretor, coordenacao |
| `PATCH /api/leads/:id/stage` | diretor, coordenacao |
| `GET /api/classes` | diretor, coordenacao, professor |
| `POST /api/classes/:id/attendance` | diretor, coordenacao, professor |
| `GET /api/portal/me` | sessao do aluno |
| `GET /api/portal/classes` | sessao do aluno |
| `POST /api/webhooks/botconversa` | segredo de webhook |

### Mitigacao adicionada

- CSRF: `apps/api/src/middleware/csrf.ts` exige que requisicoes de escrita
  (POST/PATCH/DELETE) com `Origin`/`Referer` de navegador batam com `APP_ORIGIN`.
  O webhook fica isento (tem segredo proprio) e os cookies sao `SameSite=lax`.
- A regra de papel virou funcao pura testada (`apps/api/src/domain/access.ts`)
  e ha testes de integracao da matriz de permissoes em
  `apps/api/src/routes/access.test.ts`.

### Gaps ainda abertos

- Permissao por unidade ja existe (`User.unitId` + `resolveUnitScope` em
  `apps/api/src/domain/access.ts`): coordenacao/professor com unidade
  vinculada so veem dados da propria unidade. Falta segmentar tambem os leads
  (hoje `Lead.unitInterest` e texto livre, fora do escopo).
- Falta matriz final de permissoes validada com a operacao.
- Falta revisar todos os futuros endpoints para impedir "endpoint novo sem guard".

## 4. Dados que podem ser expostos

### Dados sensiveis no sistema

- CPF.
- WhatsApp.
- E-mail.
- Historico de aula.
- Presenca e no-show.
- Saldo de creditos.
- Campanha de origem.
- Conversas ou payloads brutos de integracao.
- Precos, pacotes e dados comerciais.
- Tokens de link magico.
- Chaves de API.

### Mitigacao criada no scaffold

- CPF e WhatsApp sao mascarados em respostas onde nao precisam estar completos.
- Portal do aluno retorna apenas dados do proprio aluno.
- Webhook salva payload bruto internamente, mas nao expoe por endpoint.
- Frontend nao recebe `GEMINI_API_KEY`, BotConversa token, Meta token ou qualquer segredo.
- Sessao fica em cookie HTTP-only, nao em `localStorage`.
- Link magico e de uso unico e expira em 15 minutos.

### Gaps ainda abertos

- CPF deve ser salvo como hash para busca, nao texto puro. O schema inicial ja sugere `cpfHash`.
- WhatsApp pode exigir criptografia em repouso, dependendo do nivel de risco aceito.
- Logs precisam remover tokens, CPF completo, WhatsApp completo e payloads grandes.
- Relatorios exportados precisam de permissao propria.
- Backups precisam ser criptografados.
- Tokens de link magico devem ser enviados por WhatsApp real e nunca aparecer em producao.

## 5. Gaps de integracao BotConversa / WhatsApp

### Risco

Integracoes sao uma das maiores fontes de falha:

- Webhook duplicado criando lead duplicado.
- Payload falso criando dados.
- Payload incompleto quebrando pipeline.
- Nome/campanha vindo em texto livre.
- Reenvio de evento antigo alterando etapa atual.

### Mitigacao criada no scaffold

- Webhook exige segredo.
- Payload e validado com schema.
- Evento tem idempotencia por `eventId`.
- Payload bruto e salvo em `integration_events`.
- Lead e atualizado por WhatsApp quando ja existe.

### Gaps ainda abertos

- Confirmar formato real do BotConversa.
- Validar assinatura nativa, se existir.
- Criar fila para processar eventos sem travar request.
- Criar retentativa controlada para erros temporarios.
- Definir regra para conflitos de campanha e unidade.

## 6. Gaps de seguranca por regra de negocio

Regras que precisam permanecer no backend:

- Aula experimental ocupa vaga, mas nao consome credito.
- Presenca consome 1 credito.
- No-show nao consome credito no MVP.
- Aluno sem saldo nao agenda aula regular.
- Aula cheia nao aceita novo agendamento.
- Professor so marca presenca de aula permitida.
- Aluno so ve seus proprios dados.
- So o diretor gerencia pacotes; preco e quantidade nunca mudam.
- Coordenacao lista usuarios, mas so o diretor cria e edita.

A regra de presenca/credito ja roda no backend sobre banco real: a logica pura
fica em `apps/api/src/domain/attendance.ts` e a de agendamento em
`apps/api/src/domain/booking.ts`, ambas cobertas por testes em Vitest. A rota
`POST /api/classes/:id/attendance` aplica essa regra dentro de uma transacao Prisma.

## 7. Checklist antes de producao

- [x] Rate limit, sessoes e magic links em Redis.
- [x] Banco real e migracoes (PostgreSQL + Prisma).
- [x] Auditoria persistida em `AuditLog` (presenca, agendamento, conversao, usuarios).
- [x] Testes de credito/presenca e de agendamento (Vitest).
- [x] Testes de auth e permissoes (unitarios + integracao com supertest).
- [x] CSRF por verificacao de Origin nas requisicoes de escrita.
- [x] Logs estruturados em JSON com redacao de campos sensiveis (`apps/api/src/lib/logger.ts`).
- [x] Monitoramento de 401/403/429 via evento estruturado `access_denied` (`apps/api/src/middleware/observability.ts`).
- [x] Politica de backup: `scripts/db-backup.sh` (dump comprimido + retencao de 14); agendar via cron diario em producao.
- [x] `devMagicLink` so retornado quando `NODE_ENV=development` (`routes/portal.ts`).
- [x] CORS restrito a `APP_ORIGIN` (env) — em producao basta apontar a env para o dominio real.
- [x] Cookies `Secure` automaticos via `isProduction` (`middleware/auth.ts`).
- [x] Headers de seguranca + CSP `default-src 'none'; frame-ancestors 'none'` (`middleware/security.ts`).
- Criar usuario diretor via seed seguro, nao por senha fixa (hoje o seed aceita `ADMIN_PASSWORD` da env, mas tem fallback fixo para dev).

## 8. Decisao para o MVP

O MVP pode comecar com as protecoes atuais do scaffold, desde que seja tratado como base de desenvolvimento.

Ja resolvidos no scaffold atual:

- Banco real (PostgreSQL + Prisma) com migracao e seed.
- Sessao persistente e rate limit em Redis.
- Auditoria persistida de presenca, agendamento, conversao e usuarios.
- Testes de auth/permissoes (unitarios + integracao) e protecao CSRF por Origin.

Ainda obrigatorios antes de publicar:

- Matriz de permissoes final, incluindo segmentacao por unidade.
- Integracao BotConversa real validada.
- Deploy HTTPS com variaveis de ambiente seguras.
- Testes de auth/permissoes e estrategia de CSRF.
