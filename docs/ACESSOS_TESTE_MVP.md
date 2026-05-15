# Acessos para Testar o MVP

## URLs locais

| Area | URL | Papeis |
|---|---|---|
| Frontend | http://localhost:5173 | - |
| API health | http://localhost:3333/api/health | publico |
| Login interno | http://localhost:5173/login | - |
| Dashboard | http://localhost:5173/dashboard | diretor |
| Vendas / Leads | http://localhost:5173/vendas | diretor, coordenacao |
| Agenda | http://localhost:5173/coordenacao | diretor, coordenacao |
| Presenca | http://localhost:5173/coordenacao/presenca | diretor, coordenacao, professor |
| Alunos | http://localhost:5173/alunos | diretor, coordenacao |
| Unidades | http://localhost:5173/unidades | diretor, coordenacao |
| Configuracoes | http://localhost:5173/configuracoes | diretor |
| Portal do aluno | http://localhost:5173/portal | aluno |
| Login portal aluno | http://localhost:5173/portal/entrar | aluno |

## Login administrativo

O seed (`apps/api/prisma/seed.ts`) cria um usuario de teste para **cada papel
interno**. Todos usam a mesma senha: `admin-dev-password`.

| Papel | E-mail | Apos o login cai em | Itens no menu |
|---|---|---|---|
| diretor | admin@voxrj.com | Dashboard | todos (7) |
| coordenacao | coordenacao@voxrj.com | Vendas / Leads | Vendas, Agenda, Presenca, Alunos, Unidades |
| professor | joao.p@voxrj.com | Presenca | Presenca |

Cada papel cai automaticamente na primeira pagina que pode acessar. Use o
professor para testar a visao restrita: ele so enxerga e marca presenca das
proprias aulas.

**Permissao por unidade:** o usuario `coordenacao@voxrj.com` esta vinculado a
unidade **Matriz / Centro** — ele so ve aulas e alunos dessa unidade. O diretor
tem visao global. Crie um segundo coordenador vinculado a outra unidade
pela tela de Configuracoes para comparar.

Novos usuarios (inclusive professores) podem ser criados pela tela
**Configuracoes** sem mexer no seed.

## Portal do aluno

Para gerar um link magico em desenvolvimento:

1. Acesse http://localhost:5173/portal/entrar
2. Informe o CPF de teste:

```text
11122233344
```

3. O sistema mostra um link **clicavel** ("Entrar no portal agora") na tela.
4. Clique nele para entrar no portal.

Aluno de teste:

```text
Nome: Ana Silva
CPF: 11122233344
Unidade: Centro
Pacote: Pacote 15 aulas
Saldo: 3 creditos
```

Outro aluno do seed:

```text
Nome: Roberto Mendes
CPF: 22233344455
Unidade: Centro
Pacote: Pacote 15 aulas
Saldo: 0 creditos
```

## Dados de seed

Os dados abaixo sao criados por `npm run db:seed` e ficam persistidos no PostgreSQL.

Disciplinas (materias fixas):

```text
Pedagogias da Escuta
Expressao Corporal
Comunicacao Criativa
Comunicacao Assertiva e Lideranca   (a confirmar com a Vox RJ)
Oratoria e Argumentacao             (a confirmar com a Vox RJ)
```

Leads:

```text
Carlos Almeida   - WhatsApp 21987654321 - Matriz - Campanha CP01 Oratoria Advogados - novo_lead
Mariana Costa    - WhatsApp 21999887766 - Barra  - Origem Indicacao                - em_atendimento
```

Aula (agenda e por materia):

```text
Materia Comunicacao Assertiva e Lideranca - Centro / Sala 01 - professor Joao Pedro
Ana Silva e Roberto Mendes ja agendados
```

Unidades:

```text
Matriz / Centro   - Centro, Rio de Janeiro          - 4 salas - capacidade 48
Barra da Tijuca   - Barra da Tijuca, Rio de Janeiro - 3 salas - capacidade 36
```

Pacotes:

```text
Pacote 15 aulas - 15 aulas - R$ 1.500,00 - validade 365 dias
Pacote 7 aulas  -  7 aulas - R$ 850,00   - validade 365 dias
```

## Como rodar

Na pasta `MVP`:

```bash
cp .env.example .env       # primeira vez
docker compose up -d       # PostgreSQL + Redis
npm install
npm run db:migrate         # aplica as migrations
npm run db:seed            # cria usuarios e dados de teste
npm run dev                # sobe API (tsx watch) + web (vite) juntos
```

A API fica em `http://localhost:3333` e o frontend em `http://localhost:5173`.
A API usa `tsx watch`, entao reinicia sozinha ao salvar arquivos do backend.

## Comandos de validacao

```bash
npm run lint
npm run test
npm run build
```

Health check:

```bash
curl http://localhost:3333/api/health
```

## Exemplos de API (curl)

Login interno como diretor (guarda o cookie de sessao):

```bash
curl -i -c /tmp/vox-mvp-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@voxrj.com","password":"admin-dev-password"}' \
  http://localhost:3333/api/auth/login
```

Leitura autenticada (dashboard, leads, alunos, aulas, unidades, pacotes, usuarios):

```bash
curl -s -b /tmp/vox-mvp-cookies.txt http://localhost:3333/api/dashboard
curl -s -b /tmp/vox-mvp-cookies.txt 'http://localhost:3333/api/dashboard?unit=Centro'
curl -s -b /tmp/vox-mvp-cookies.txt 'http://localhost:3333/api/leads?pageSize=5'
curl -s -b /tmp/vox-mvp-cookies.txt http://localhost:3333/api/students
curl -s -b /tmp/vox-mvp-cookies.txt http://localhost:3333/api/subjects
curl -s -b /tmp/vox-mvp-cookies.txt http://localhost:3333/api/classes
curl -s -b /tmp/vox-mvp-cookies.txt http://localhost:3333/api/units
curl -s -b /tmp/vox-mvp-cookies.txt http://localhost:3333/api/packages
curl -s -b /tmp/vox-mvp-cookies.txt http://localhost:3333/api/users
```

Criar um professor (diretor):

```bash
curl -i -b /tmp/vox-mvp-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Marina Souza","email":"marina@voxrj.com","password":"vox-professora-2026","roles":["professor"]}' \
  http://localhost:3333/api/users
```

Desativar/ativar um usuario (diretor):

```bash
curl -i -b /tmp/vox-mvp-cookies.txt -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{"active":false}' \
  http://localhost:3333/api/users/<userId>
```

## Webhook BotConversa de teste

Segredo local:

```text
dev-webhook-secret-change-before-prod
```

Exemplo:

```bash
curl -i \
  -H 'Content-Type: application/json' \
  -H 'X-VOX-Webhook-Secret: dev-webhook-secret-change-before-prod' \
  -d '{
    "eventId": "evt_teste_001",
    "contact": {
      "id": "bot_001",
      "name": "Lead Teste",
      "whatsapp": "21911112222"
    },
    "fields": {
      "unitInterest": "Barra",
      "campaign": "CP Teste"
    }
  }' \
  http://localhost:3333/api/webhooks/botconversa
```

## Observacoes importantes

- Estes acessos sao somente para desenvolvimento local.
- A senha e os segredos estao em `MVP/.env`.
- Em producao, trocar `ADMIN_PASSWORD`, `SESSION_SECRET` e `WEBHOOK_SECRET`.
- O `docker-compose.yml` expoe PostgreSQL em `localhost:5433` e Redis em
  `localhost:6380` (portas alternativas para nao conflitar com servicos locais
  em 5432/6379). O `.env` ja aponta para essas portas.
- Os dados (usuarios, leads, alunos, aulas, agendamentos, presencas, unidades,
  pacotes) sao persistidos no PostgreSQL e sobrevivem ao restart da API. Para
  voltar ao estado inicial do seed, rode novamente `npm run db:seed`.
- Sessoes, rate limit e magic links ficam no Redis e tambem sobrevivem ao restart
  da API, mas expiram conforme o TTL de cada um.
- A API usa cookie HTTP-only; por isso o token de sessao nao aparece no frontend.
- O frontend e um PWA: pelo navegador (Chrome/Safari) da para instalar como app
  ("adicionar a tela inicial"), com icone proprio. Ainda nao tem cache offline.
