import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import path from 'node:path';
import { Pool } from 'pg';
import {
  createBotConversaApi,
  lastPageNumbers,
  SUBSCRIBERS_PER_PAGE,
} from '../src/lib/botconversa-api.js';
import {
  MIN_PHONE_DIGITS,
  normalizePhone,
  resolveLeadFromSubscriber,
  tagNamesOf,
} from '../src/lib/botconversa-sync.js';
import type { BotConversaSubscriber } from '../src/lib/botconversa-sync.js';

// Poll INCREMENTAL (Opcao C): le apenas as ultimas paginas de /subscribers/
// — onde caem os contatos novos, ja que a API ordena do mais antigo para o
// mais novo — e faz upsert dos leads. Leve (poucas requisicoes) e idempotente:
// re-rodar nao causa dano. Pensado para um cron de poucos em poucos minutos.
// A regra de merge mora em `botconversa-sync.ts`, a mesma usada pelo import.

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const API_KEY = process.env.BOTCONVERSA_API_KEY;
if (!API_KEY) {
  console.error('erro: BOTCONVERSA_API_KEY ausente no ambiente.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const api = createBotConversaApi(API_KEY);

// Lock distribuido pra evitar duas instancias do cron rodando ao mesmo
// tempo (clock skew, retry manual sobreposto, etc). Sem o lock, ambas
// liam a mesma pagina e criavam Leads duplicados pelo mesmo subscriber.
const LOCK_KEY = 'lock:botconversa-poll';
const LOCK_TTL_SECONDS = 300; // 5min — janela maior que o tempo medio do job
const LOCK_TOKEN = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function acquireLock(redis: Redis): Promise<boolean> {
  // SET NX EX: so seta se a chave nao existir, com TTL automatico.
  // Token unico permite verificar ownership na liberacao (evita liberar
  // lock de outra instancia se este job atrasar alem do TTL).
  const result = await redis.set(LOCK_KEY, LOCK_TOKEN, 'EX', LOCK_TTL_SECONDS, 'NX');
  return result === 'OK';
}

async function releaseLock(redis: Redis): Promise<void> {
  // Lua script atomico: so deleta se o valor ainda for o nosso token.
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, LOCK_KEY, LOCK_TOKEN);
}

// Cache local de slug → stageId, populado uma vez por execucao do job.
// LeadStage virou tabela na migration 20260526200000; o sync precisa
// resolver o slug retornado pelo dominio puro pra FK persistivel.
async function loadStageMap(): Promise<Map<string, string>> {
  const stages = await prisma.leadStage.findMany({ select: { id: true, slug: true } });
  return new Map(stages.map((s) => [s.slug, s.id]));
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('erro: REDIS_URL ausente — lock distribuido requer Redis.');
    process.exit(1);
  }
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });

  const got = await acquireLock(redis);
  if (!got) {
    console.log('poll botconversa: outro job em execucao — skip.');
    await redis.quit();
    return;
  }

  try {
    const stageMap = await loadStageMap();
    const novoLeadStageId = stageMap.get('novo_lead');
    if (!novoLeadStageId) {
      throw new Error('LeadStage `novo_lead` ausente no banco — migration nao aplicada?');
    }

    const tagsList = await api.getTags();
    const tagsById = new Map(tagsList.map((tag) => [tag.id, tag.name]));

    // A pagina 1 so serve para descobrir o total e o tamanho de pagina real;
    // os contatos recentes estao nas ultimas paginas.
    const firstPage = await api.getSubscribersPage<BotConversaSubscriber>(1);
    const perPage = firstPage.next ? firstPage.results.length : SUBSCRIBERS_PER_PAGE;
    const pages = lastPageNumbers(firstPage.count, perPage);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const pageNum of pages) {
      const page =
        pageNum === 1 ? firstPage : await api.getSubscribersPage<BotConversaSubscriber>(pageNum);

      for (const sub of page.results) {
        const phone = normalizePhone(sub.phone);
        if (phone.length < MIN_PHONE_DIGITS) {
          skipped += 1;
          continue;
        }

        const tagNames = tagNamesOf(sub, tagsById);
        const existingLeadRow = await prisma.lead.findFirst({
          where: { whatsapp: phone },
          include: { stage: { select: { slug: true } } },
        });
        const existingLead = existingLeadRow
          ? {
              id: existingLeadRow.id,
              name: existingLeadRow.name,
              unitInterest: existingLeadRow.unitInterest,
              campaign: existingLeadRow.campaign,
              stageSlug: existingLeadRow.stage.slug,
              botconversaContactId: existingLeadRow.botconversaContactId,
            }
          : null;

        const result = resolveLeadFromSubscriber({
          subscriber: sub,
          tagNames,
          existingLead,
          source: 'BotConversa',
        });

        if (result.action === 'create') {
          const stageId = stageMap.get(result.data.stage) ?? novoLeadStageId;
          const { stage: _slug, ...rest } = result.data;
          await prisma.lead.create({ data: { ...rest, stageId } });
          created += 1;
        } else if (result.action === 'update') {
          const stageId = stageMap.get(result.data.stage) ?? novoLeadStageId;
          const { stage: _slug, ...rest } = result.data;
          await prisma.lead.update({
            where: { id: result.leadId },
            data: { ...rest, stageId },
          });
          updated += 1;
        } else {
          skipped += 1;
        }
      }
    }

    console.log(
      `poll botconversa: paginas=[${pages.join(',')}] total=${firstPage.count} ` +
        `criados=${created} atualizados=${updated} pulados=${skipped}`,
    );
  } finally {
    await releaseLock(redis);
    await redis.quit();
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error('poll falhou:', error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
