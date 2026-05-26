import type { LeadStage, PrismaClient } from '@prisma/client';
import { prisma } from '../db/client.js';

// Slugs reservados — codigo do app escreve neles em pontos especificos
// (webhook, conversao, sync do BotConversa). Sao seedados em
// 20260526200000_lead_stage_to_table como `systemic: true`.
export const SYSTEMIC_STAGE_SLUGS = [
  'novo_lead',
  'em_atendimento',
  'pre_agendamento',
  'experimental_agendada',
  'matriculado',
  'perdido',
] as const;
export type SystemicStageSlug = (typeof SYSTEMIC_STAGE_SLUGS)[number];

// Cache em memoria de slug -> id. Evita N+1 em hot paths (cada upsert
// do sync resolve "novo_lead" -> id). Invalidado em qualquer escrita
// pela rota /api/stages.
let cache: Map<string, LeadStage> | null = null;

export function invalidateLeadStageCache(): void {
  cache = null;
}

type TxClient = Pick<PrismaClient, 'leadStage'>;

export async function getLeadStageBySlug(slug: string, client?: TxClient): Promise<LeadStage> {
  const db = client ?? prisma;
  if (!cache) {
    const rows = await db.leadStage.findMany();
    cache = new Map(rows.map((row) => [row.slug, row]));
  }
  const cached = cache.get(slug);
  if (cached) return cached;

  // Cache miss — pode acontecer logo apos criar etapa nova noutro processo.
  // Refaz a leitura sem cache.
  const fresh = await db.leadStage.findUnique({ where: { slug } });
  if (!fresh) {
    throw new Error(`LeadStage com slug "${slug}" nao existe.`);
  }
  cache.set(slug, fresh);
  return fresh;
}

export async function getLeadStageIdBySlug(
  slug: string,
  client?: TxClient,
): Promise<string> {
  const row = await getLeadStageBySlug(slug, client);
  return row.id;
}
