# Integracao BotConversa

Esta nota descreve o que precisa para ligar o MVP da Vox RJ ao BotConversa,
tanto no sentido de **entrada** (BotConversa -> nosso webhook, ja parcialmente
implementado) quanto no de **saida** (nosso backend -> BotConversa, para
enviar o link magico do portal e os lembretes futuros).

## 1. Por que BotConversa

A `Transcricao.docx` da reuniao de alinhamento define o BotConversa como
**primeira integracao** do MVP — ele e o canal oficial de conversa com leads
no WhatsApp. Tudo que chega pelo WhatsApp (mensagem, campanha, tags) passa
por la, e e o lugar natural pra disparar mensagens de volta (link magico,
confirmacoes). A "API nao oficial" mencionada na reuniao e prevista para
casos especiais (grupos, lembretes em massa) e fica para depois.

## 2. Status no codigo

| Sentido | Endpoint | Estado |
|---|---|---|
| Entrada (BotConversa -> Vox) | `POST /api/webhooks/botconversa` | **Implementado** (`apps/api/src/routes/webhooks.ts`): valida segredo via header `X-VOX-Webhook-Secret`, idempotente por `eventId`, registra payload bruto em `IntegrationEvent` e cria/atualiza o `Lead`. |
| Saida (Vox -> BotConversa) | `POST /api/v1/webhook/subscriber/{id}/send_message/` | **Nao implementado**. Precisa de cliente HTTP, API key e mapeamento de telefone -> `subscriber_id`. |

## 3. API do BotConversa (resumo tecnico)

- **URL base**: `https://backend.botconversa.com.br/api/v1/webhook/`
- **Autenticacao**: header `API-KEY: <chave>` em todas as requisicoes.
  A chave fica no painel do BotConversa em
  **Configuracoes > Integracoes > Webhook Integration**.
- **Rate limit**: 600 RPM (10 req/s).
- **Swagger interativo**: <https://backend.botconversa.com.br/swagger/>

### Endpoints relevantes para o MVP

| Metodo | Path | Uso |
|---|---|---|
| `POST` | `/subscriber/` | Cria contato (`phone`, `first_name`, `last_name`, `has_opt_in_whatsapp`). |
| `GET`  | `/subscriber/get_by_phone/{phone}/` | Busca contato pelo numero (com ou sem `+`). Retorna `id`, tags, variables e sequences. |
| `POST` | `/subscriber/{subscriber_id}/send_message/` | Envia mensagem (`type`: `"text"` ou `"file"`; `value`: conteudo). |
| `GET`  | `/tags/` | Lista as tags da conta. |
| `POST` | `/subscriber/{subscriber_id}/tags/{tag_id}/` | Aplica tag ao contato. |
| `DELETE` | `/subscriber/{subscriber_id}/tags/{tag_id}/` | Remove tag. |
| `GET`  | `/custom_fields/` | Lista os campos personalizados (id, key, type). |
| `POST` | `/subscriber/{subscriber_id}/custom_fields/{field_id}/` | Define valor de campo (`value` no body; datas em `dd.mm.yyyy`). |
| `DELETE` | `/subscriber/{subscriber_id}/custom_fields/{field_id}/` | Limpa o valor. |

## 4. Webhook de entrada — payload esperado hoje

O `BotConversaPayloadSchema` em `apps/api/src/routes/webhooks.ts` espera:

```json
{
  "eventId": "string (ID externo, usado para idempotencia)",
  "contact": {
    "id": "string (opcional, id do contato no BotConversa)",
    "name": "string",
    "whatsapp": "string (so digitos, ate 30 caracteres)"
  },
  "fields": {
    "unitInterest": "string (opcional)",
    "campaign": "string (opcional)"
  }
}
```

E precisa do header `X-VOX-Webhook-Secret: <WEBHOOK_SECRET>` para passar.

> Esse formato e uma **suposicao** feita antes de ter acesso ao painel.
> Quando o acesso chegar, comparar com o que o BotConversa entrega de fato
> via "Bloco de Integracao" do fluxo. Se divergir, ajusta o schema (ou o
> mapeamento no painel).

## 5. Checklist do que pegar/configurar no painel do BotConversa

Quando o acesso chegar:

- [ ] Copiar a **API key** em *Configuracoes > Integracoes > Webhook Integration*
      e colocar em `BOTCONVERSA_API_KEY` no `.env` da producao (e em `.env.example`).
- [ ] Listar os **custom fields** existentes (`GET /custom_fields/`) e mapear:
  - qual campo guarda a **campanha** (vira `fields.campaign` no nosso webhook)
  - qual campo guarda a **unidade de interesse** (vira `fields.unitInterest`)
- [ ] Listar as **tags** existentes (`GET /tags/`); identificar uma tag de
      "lead novo" / "matriculado" para refletir o estado no nosso pipeline.
- [ ] No fluxo do BotConversa, adicionar um **bloco de integracao** que faz
      `POST` no nosso `https://<dominio>/api/webhooks/botconversa` com:
  - header `X-VOX-Webhook-Secret: <WEBHOOK_SECRET>`
  - body no formato da secao 4 (mapear as variaveis do fluxo para `eventId`,
    `contact.*`, `fields.*`)
- [ ] Configurar o gatilho: quando o lead conclui o passo de captura
      (depois de informar nome + unidade), o bloco dispara para o nosso webhook.

## 6. Envio de mensagem (saida) — proposta para o magic link

O magic link do portal hoje so e devolvido no JSON quando `NODE_ENV=development`
(`devMagicLink`). Em producao, a coordenacao pediria o link e o aluno nunca
receberia — o portal fica inacessivel sem entrega. Proposta:

```
[Aluno digita CPF no portal]
        |
        v
POST /api/portal/magic-links { cpf }
        |
   (lookup do student por cpfHash)
        |
   (se existe) -> redis.set(magic:<token>, studentId, EX=15min)
        |
   GET https://backend.botconversa.com.br/api/v1/webhook/subscriber/get_by_phone/{student.whatsapp}/
        |
   POST .../subscriber/{id}/send_message/  body: { type:'text', value: "Seu link de acesso ao portal Vox: <APP_ORIGIN>/portal/entrar?token=<token>" }
        |
   res.json({ sent: true })   // nao devolve devMagicLink em prod
```

Implementacao concreta (proximo PR):

1. `lib/botconversa.ts` — cliente HTTP fino: `getSubscriberByPhone(phone)` e
   `sendMessage(subscriberId, text)`. Usa `fetch` global do Node 22, com
   timeout (`AbortSignal.timeout(5000)`), header `API-KEY` da env e tratamento
   de 404 (contato nao existe) sem vazar a existencia do aluno.
2. `routes/portal.ts` — chamar o cliente apos criar o token; manter
   `res.json({ sent: true })` sempre (nao revelar se o CPF existe ou se o
   envio falhou).
3. `config/env.ts` — adicionar `BOTCONVERSA_API_KEY` (opcional em dev,
   obrigatorio em prod).
4. Logar o resultado em `IntegrationEvent` (`source: 'botconversa-send'`)
   para auditoria.

## 7. Lembretes (fase 2)

Os mesmos endpoints (`get_by_phone` + `send_message`) servem para os
lembretes de aula citados na transcricao (1:35-1:36). A diferenca e que a
transcricao prefere "numero nao oficial" para disparos em massa/grupos, o
que e uma integracao separada — fora do escopo do MVP atual.

## 8. Decisoes pendentes (a confirmar com o cliente)

- Qual o canal de entrega do magic link: BotConversa (recomendado, ja
  integrado) ou WhatsApp via numero nao oficial?
- Frase do template do magic link (texto livre, mas vale alinhar tom).
- Se o link expira em 15min (atual) ou outro tempo.

## 9. Referencias

- Documentacao geral: <https://botconversa.gitbook.io/bem-vindo-ao-botconversa/integracoes/api-botconversa>
- Central de ajuda: <https://ajuda.botconversa.com.br/integracoes/api-botconversa/documentacao-api-botconversa>
- Swagger interativo: <https://backend.botconversa.com.br/swagger/>
