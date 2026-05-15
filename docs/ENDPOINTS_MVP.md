# Endpoints iniciais do MVP

## Publicos controlados

| Metodo | Endpoint | Uso | Protecao |
|---|---|---|---|
| `GET` | `/api/health` | Status da API | Rate limit geral |
| `POST` | `/api/auth/login` | Login interno | Rate limit auth |
| `POST` | `/api/portal/magic-links` | Solicitar link do aluno | Rate limit portal |
| `POST` | `/api/portal/sessions` | Consumir link magico | Rate limit portal |
| `POST` | `/api/webhooks/botconversa` | Receber evento do BotConversa | Segredo + rate limit webhook |

## Internos

| Metodo | Endpoint | Roles |
|---|---|---|
| `GET` | `/api/auth/me` | usuario autenticado |
| `POST` | `/api/auth/logout` | usuario autenticado |
| `GET` | `/api/dashboard` | diretor (aceita `?unitId=` para filtrar) |
| `GET` | `/api/subjects` | diretor, coordenacao |
| `GET` | `/api/users` | diretor, coordenacao |
| `POST` | `/api/users` | diretor |
| `PATCH` | `/api/users/:userId` | diretor |
| `GET` | `/api/leads` | diretor, coordenacao |
| `POST` | `/api/leads` | diretor, coordenacao |
| `PATCH` | `/api/leads/:leadId/stage` | diretor, coordenacao |
| `POST` | `/api/leads/:leadId/convert` | diretor, coordenacao (converte lead em aluno) |
| `GET` | `/api/students` | diretor, coordenacao |
| `GET` | `/api/students/:studentId` | diretor, coordenacao |
| `POST` | `/api/students` | diretor (cadastro avulso de aluno) |
| `GET` | `/api/classes` | diretor, coordenacao, professor (professor ve so as proprias) |
| `POST` | `/api/classes` | diretor, coordenacao (aula por materia ou `isGuest`) |
| `POST` | `/api/classes/:classId/attendance` | diretor, coordenacao, professor (professor so na propria aula) |
| `GET` | `/api/units` | diretor, coordenacao |
| `POST` | `/api/units` | diretor, coordenacao |
| `PATCH` | `/api/units/:unitId` | diretor, coordenacao |
| `GET` | `/api/packages` | diretor, coordenacao |
| `POST` | `/api/packages` | diretor |
| `PATCH` | `/api/packages/:packageId` | diretor (renomeia / ativa / desativa) |

## Portal do aluno

| Metodo | Endpoint | Escopo |
|---|---|---|
| `POST` | `/api/portal/logout` | aluno logado |
| `GET` | `/api/portal/me` | somente aluno logado |
| `GET` | `/api/portal/classes` | somente aluno logado |
| `POST` | `/api/portal/classes/:classId/book` | somente aluno logado |
| `DELETE` | `/api/portal/classes/:classId/book` | somente aluno logado |

## Regras de resposta

- Listas devem ser paginadas.
- Dados sensiveis devem ser mascarados quando nao forem essenciais.
- Payload bruto de webhook nao deve ser retornado para frontend.
- Erros devem retornar codigo estavel em `error.code`.
- `429` deve ser tratado no frontend com mensagem clara.

## Permissao por unidade

- `User.unitId` define o escopo de unidade do usuario.
- `diretor` tem visao global da rede, independentemente da unidade vinculada.
- `coordenacao` e `professor` com unidade vinculada so enxergam e
  alteram dados (aulas, alunos, presenca) da propria unidade.
- Leads ficam fora do escopo por unidade: `Lead.unitInterest` e texto livre
  capturado da conversa, nao um vinculo formal com `Unit`.
