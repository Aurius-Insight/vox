import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';
import { deriveStage, deriveUnit, VOX_UNITS } from '../src/lib/botconversa-mapping.js';

// Carrega .env do root (MVP/.env), depois sobrepoe com local se houver.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const API_KEY = process.env.BOTCONVERSA_API_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const BASE = 'https://backend.botconversa.com.br/api/v1/webhook';

if (!API_KEY) {
  console.error('erro: BOTCONVERSA_API_KEY ausente no ambiente.');
  process.exit(1);
}

// Script roda fora do servidor (one-shot); prefere DIRECT_URL pra escapar do
// pooler do Supabase, que pode atrapalhar volumes de upsert em transacao.
const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type TagEntry = { id: number; name: string };
type Subscriber = {
  id: number;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string;
  tags?: Array<number | { id?: number; name?: string }>;
  campaigns?: Array<{ name?: string }>;
};
type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'API-KEY': API_KEY!, accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}: ${await response.text().catch(() => '')}`);
  }
  return response.json() as Promise<T>;
}

/** Normaliza a lista de tags do subscriber (id ou objeto) para nomes string. */
function tagNamesOf(sub: Subscriber, tagsById: Map<number, string>): string[] {
  return (sub.tags ?? [])
    .map((t) => {
      if (typeof t === 'number') return tagsById.get(t) ?? '';
      if (typeof t === 'object' && t !== null) return t.name ?? (t.id ? tagsById.get(t.id) ?? '' : '');
      return String(t ?? '');
    })
    .filter(Boolean);
}

async function ensureUnits() {
  // Cria as 6 unidades reais (idempotente por id determinista).
  for (const name of VOX_UNITS) {
    const id = `unit_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    await prisma.unit.upsert({
      where: { id },
      update: { name, active: true },
      create: {
        id,
        name,
        address: `${name}, Rio de Janeiro`,
        capacity: 12,
        active: true,
      },
    });
  }
}

async function main() {
  console.log(`modo: ${DRY_RUN ? 'DRY-RUN (sem escrita)' : 'PRODUCAO (escrita habilitada)'}`);

  // 1) Carrega o catalogo de tags (id -> nome).
  const tagsList = await fetchJson<TagEntry[]>(`${BASE}/tags/`);
  const tagsById = new Map(tagsList.map((t) => [t.id, t.name]));
  console.log(`tags conhecidas no painel: ${tagsList.length}`);

  // 2) Garante as 6 unidades reais antes de importar (no modo prod).
  if (!DRY_RUN) {
    await ensureUnits();
    console.log(`unidades garantidas: ${VOX_UNITS.join(', ')}`);
  }

  // 3) Pagina sobre /subscribers/ e processa cada um.
  let url: string | null = `${BASE}/subscribers/?page=1`;
  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const stageCounts: Record<string, number> = {};
  const unitCounts: Record<string, number> = {};

  while (url) {
    const page = await fetchJson<Page<Subscriber>>(url);
    for (const sub of page.results) {
      const phone = (sub.phone ?? '').replace(/\D/g, '');
      if (!phone || phone.length < 8) {
        totalSkipped++;
        continue;
      }

      const tagNames = tagNamesOf(sub, tagsById);
      const campaignName = sub.campaigns?.[0]?.name ?? null;
      const stage = deriveStage(tagNames);
      const unit = deriveUnit(tagNames, campaignName);

      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
      const unitKey = unit ?? '(nao detectado)';
      unitCounts[unitKey] = (unitCounts[unitKey] ?? 0) + 1;

      if (!DRY_RUN) {
        const existing = await prisma.lead.findFirst({ where: { whatsapp: phone } });
        if (existing) {
          // Preserva o que ja foi trabalhado pelo time; complementa o que falta.
          await prisma.lead.update({
            where: { id: existing.id },
            data: {
              name: sub.full_name ?? existing.name,
              unitInterest: existing.unitInterest === 'Nao informado' && unit ? unit : existing.unitInterest,
              campaign: existing.campaign ?? campaignName ?? undefined,
              botconversaContactId: existing.botconversaContactId ?? String(sub.id),
              // Stage so e atualizado quando o existente ainda esta em "novo_lead"
              // (importacao inicial); leads ja trabalhados nao regridem.
              stage: existing.stage === 'novo_lead' ? stage : existing.stage,
            },
          });
          totalUpdated++;
        } else {
          await prisma.lead.create({
            data: {
              name: sub.full_name ?? 'Sem nome',
              whatsapp: phone,
              unitInterest: unit ?? 'Nao informado',
              campaign: campaignName ?? undefined,
              source: 'BotConversa (import)',
              stage,
              botconversaContactId: String(sub.id),
            },
          });
          totalCreated++;
        }
      }

      totalProcessed++;
    }

    url = page.next;
    // 100ms entre paginas: dentro do rate limit (600 RPM) e gentil com a API.
    if (url) await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n=== RESULTADO ===');
  console.log(`processados: ${totalProcessed}`);
  if (!DRY_RUN) {
    console.log(`criados: ${totalCreated}, atualizados: ${totalUpdated}`);
  }
  console.log(`pulados (sem telefone): ${totalSkipped}`);

  console.log('\nDistribuicao por stage:');
  for (const [s, c] of Object.entries(stageCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(24)} ${c}`);
  }

  console.log('\nDistribuicao por unidade:');
  for (const [u, c] of Object.entries(unitCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${u.padEnd(24)} ${c}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error('importacao falhou:', error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
