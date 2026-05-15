# Vox RJ MVP

Base inicial do MVP, separada do prototipo em `Docs/Interface`.

## Estrutura

```text
apps/
  api/    Backend, auth, regras de negocio e integracoes
  web/    Frontend React/Vite com guards de auth
docs/     Decisoes, gaps e checklist de seguranca
```

## Principios do MVP

- Nenhuma chave sensivel no frontend.
- Endpoints internos protegidos por sessao e role.
- Portal do aluno isolado da area administrativa.
- Webhooks protegidos por segredo e idempotencia.
- Rate limit em login, portal, webhooks e API geral.
- Respostas da API com dados sanitizados por perfil.
- Regras de credito, presenca, vagas e permissao sempre no backend.

## Primeiros comandos

```bash
cp .env.example .env
docker compose up -d   # PostgreSQL + Redis
npm install
npm run db:migrate     # aplica as migrations
npm run db:seed        # cria admin, professor e dados de teste
npm run dev
```

O backend inicia em `http://localhost:3333` e o frontend em `http://localhost:5173`.

## Status

O MVP ja roda sobre banco real: PostgreSQL via Prisma, com migration inicial em
`apps/api/prisma/migrations` e seed em `apps/api/prisma/seed.ts`.

Sessoes, rate limit e magic links usam Redis. Suba os servicos com `docker-compose up -d`
antes de rodar a API.

Ja existe suite de testes (`npm run test`) cobrindo as regras criticas de
credito, presenca e agendamento.

As oito telas administrativas estao conectadas a endpoints reais (dashboard, vendas,
agenda, presenca, alunos, unidades, configuracoes e portal do aluno).

A tela de Configuracoes ja cria usuarios (incluindo professores, com materia
vinculada) e ativa/desativa acesso, sem precisar mexer no seed.

Alinhado a transcricao da reuniao de arquitetura:

- A agenda e organizada por **materia** (5 disciplinas fixas); cada professor
  representa uma materia. Existe a categoria "professor convidado".
- O dashboard tem filtro por unidade e metricas de funil, comparecimento,
  ocupacao, alunos ativos e alunos sem saldo.
- O portal do aluno fala em "aulas" (nao "creditos") e mostra as aulas feitas
  por disciplina.
- O frontend e um PWA instalavel ("adicionar a tela inicial").
- A conversao **lead -> aluno** ja existe: pela tela de Vendas, gera o codigo de
  matricula, vincula o pacote (saldo = quantidade de aulas) e marca o lead como
  matriculado. O perfil do aluno mostra a origem (campanha).
- Cadastro avulso de aluno (tela de Alunos), edicao/desativacao de pacotes
  (Configuracoes) e edicao/desativacao de unidades (Unidades).
- Aulas, alunos e usuarios referenciam `Unit` por FK. Cada usuario pode ter uma
  unidade vinculada: coordenacao/vendas/professor com unidade so enxergam os
  dados dela; admin/gestor tem visao global.

Ainda em aberto: calendario ciclico mensal da agenda, janela de lancamento de
presenca, e ligar `Lead.unitInterest` a `Unit` (hoje e texto livre da conversa).
