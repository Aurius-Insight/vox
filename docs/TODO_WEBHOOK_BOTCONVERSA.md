# TODO — Configurar webhook BotConversa em tempo real

Pendente: ligar o BotConversa pra mandar leads novos pro Vox **automaticamente**
em vez de depender do re-import.

**Quando fechar isso**, lead que entrar pelo WhatsApp aparece no Kanban da
`/vendas` em segundos.

## Estado atual

- ✅ Webhook codado e testado (`POST /api/webhooks/botconversa`)
- ✅ HTTPS publico ativo (cert Let's Encrypt em `vox.voxrio.xyz`)
- ✅ Idempotencia por `eventId` (mesmo evento 2× nao cria 2 leads)
- ✅ Validacao de segredo via header `X-VOX-Webhook-Secret`
- ❌ **Bloco de integracao nao configurado no painel BotConversa**

## O que falta — checklist

- [ ] Abrir painel BotConversa
- [ ] No fluxo principal de captacao de leads (o que pega nome + unidade)
- [ ] Adicionar **Bloco de Integracao** logo apos a captura
- [ ] Configurar conforme tabela abaixo
- [ ] Salvar fluxo
- [ ] Testar mandando 1 mensagem nova pro WhatsApp da Vox
- [ ] Verificar no Kanban (`vox.voxrio.xyz/vendas`) se o lead apareceu

## Configuracao do Bloco de Integracao

### URL
```
https://vox.voxrio.xyz/api/webhooks/botconversa
```

### Metodo
```
POST
```

### Headers
```
X-VOX-Webhook-Secret: 3a22dab3af91b0ced08a82da4f60d591
Content-Type: application/json
```

> ⚠️ **O segredo acima vazou em chat — rotacionar depois.** Gera novo com
> `openssl rand -hex 16`, atualiza no `.env` da VPS (`/opt/vox/app/.env`),
> roda `docker compose restart api` em `/opt/vox/app/`, e atualiza tambem
> no painel BotConversa.

### Body (template — adapta as variaveis do fluxo BotConversa)

```json
{
  "eventId": "{{event_id_unico_do_fluxo}}",
  "contact": {
    "id": "{{subscriber_id}}",
    "name": "{{first_name}}",
    "whatsapp": "{{phone}}"
  },
  "fields": {
    "campaign": "{{nome_da_campanha_ou_fluxo}}",
    "unitInterest": "{{unidade_interesse}}"
  }
}
```

### Mapeando as variaveis do BotConversa

Substitua `{{...}}` pelas variaveis reais do fluxo:

| Nosso campo | Variavel tipica no BotConversa | Obrigatorio? |
|---|---|---|
| `eventId` | qualquer ID unico — pode ser `{{subscriber_id}}_{{timestamp}}` ou similar | ✅ sim (idempotencia) |
| `contact.id` | `{{subscriber_id}}` ou `{{contact.id}}` | opcional |
| `contact.name` | `{{first_name}}` ou `{{full_name}}` | ✅ sim |
| `contact.whatsapp` | `{{phone}}` (com ou sem `+`) | ✅ sim |
| `fields.campaign` | nome do fluxo OU custom field "Nome do Fluxo" | opcional |
| `fields.unitInterest` | nao tem campo dedicado hoje — pode mandar tag ou texto da unidade | opcional |

**Sobre unidade**: a Vox nao guarda unidade num custom field — esta nas
tags. O webhook aceita `fields.unitInterest` vazio; nosso sistema cai em
"Nao informado" e a coordenacao preenche depois. **Ou** voce cria um
custom field "unidade_interesse" no painel e adiciona no fluxo.

## Testar depois de configurar

Manda 1 mensagem nova pro WhatsApp da Vox, completa o fluxo, e olha o
Kanban em <https://vox.voxrio.xyz/vendas>. Deve aparecer um lead novo na
coluna "Novo lead" em segundos.

Se nao aparecer, conferir:

1. **Logs do bloco no BotConversa** (status do POST — deve ser 202 ou 200)
2. **Logs do nosso webhook** na VPS:
   ```bash
   ssh root@187.77.22.210 'docker logs vox-api --tail 50 | grep webhook'
   ```
3. **Tabela `IntegrationEvent`** (audit do raw payload):
   ```bash
   ssh root@187.77.22.210 'docker exec vox-postgres psql -U vox -d vox -c \
     "SELECT \"processedAt\", \"externalEventId\" FROM \"IntegrationEvent\" \
      ORDER BY \"processedAt\" DESC LIMIT 5;"'
   ```

## O que NAO muda automaticamente (importante)

Mesmo com o webhook ativo, **mudanca de tag no BotConversa NAO atualiza
o stage do lead no Kanban**. O caminho oficial da operacao e:

- BotConversa: porta de entrada do lead (chega + dados)
- Vox Kanban: fonte da verdade do funil (Suelen arrasta cards la)

Se um dia for desejavel sync de tag → stage, precisaria de um segundo
endpoint webhook + configurar evento "tag adicionada" no BotConversa.
Hoje nao esta implementado.

## Rede de seguranca: re-import semanal (opcional)

Pra cobrir possiveis falhas (bloco fora do ar, falha de rede, etc.),
configurar cron semanal de re-import:

```bash
ssh root@187.77.22.210
echo '0 4 * * 0 root cd /opt/vox/app && docker compose exec -T api npx tsx apps/api/scripts/import-botconversa.ts >> /opt/vox/import.log 2>&1' \
  > /etc/cron.d/vox-import
chmod 644 /etc/cron.d/vox-import
```

Roda **toda madrugada de domingo**, leva ~15min, e e idempotente — nao
duplica leads, nao regride stage de quem ja foi trabalhado.
