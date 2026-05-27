import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';
import { createBotConversaApi } from '../src/lib/botconversa-api.js';
import { deriveStage, deriveUnit, VOX_UNITS } from '../src/lib/botconversa-mapping.js';
import {
  MIN_PHONE_DIGITS,
  normalizePhone,
  resolveLeadFromSubscriber,
  tagNamesOf,
} from '../src/lib/botconversa-sync.js';
import type { BotConversaSubscriber } from '../src/lib/botconversa-sync.js';

// Import em LOTE (Opcao A): varre todos os contatos do BotConversa e faz
// upsert dos leads. Pensado para um cron diario — cobre leads novos e
// mudanca de etapa. Idempotente: nao duplica nem regride leads trabalhados.
// A regra de merge mora em `botconversa-sync.ts`, compartilhada com o poll.

// Carrega .env do root (MVP/.env), depois sobrepoe com local se houver.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const API_KEY = process.env.BOTCONVERSA_API_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

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
const api = createBotConversaApi(API_KEY);

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

// Cache local de slug → stageId; LeadStage virou tabela na migration
// 20260526200000, e o import precisa resolver pra FK.
async function loadStageMap(): Promise<Map<string, string>> {
  const stages = await prisma.leadStage.findMany({ select: { id: true, slug: true } });
  return new Map(stages.map((s) => [s.slug, s.id]));
}

async function main() {
  console.log(`modo: ${DRY_RUN ? 'DRY-RUN (sem escrita)' : 'PRODUCAO (escrita habilitada)'}`);

  // 1) Carrega o catalogo de tags (id -> nome).
  const tagsList = await api.getTags();
  const tagsById = new Map(tagsList.map((tag) => [tag.id, tag.name]));
  console.log(`tags conhecidas no painel: ${tagsList.length}`);

  // 2) Garante as 6 unidades reais antes de importar (no modo prod).
  if (!DRY_RUN) {
    await ensureUnits();
    console.log(`unidades garantidas: ${VOX_UNITS.join(', ')}`);
  }

  const stageMap = DRY_RUN ? new Map<string, string>() : await loadStageMap();
  const novoLeadStageId = stageMap.get('novo_lead');
  if (!DRY_RUN && !novoLeadStageId) {
    throw new Error('LeadStage `novo_lead` ausente no banco — migration nao aplicada?');
  }

  // 3) Pagina sobre /subscribers/ e processa cada contato.
  let pageNum = 1;
  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const stageCounts: Record<string, number> = {};
  const unitCounts: Record<string, number> = {};

  for (;;) {
    const page = await api.getSubscribersPage<BotConversaSubscriber>(pageNum);

    for (const sub of page.results) {
      const phone = normalizePhone(sub.phone);
      if (phone.length < MIN_PHONE_DIGITS) {
        totalSkipped += 1;
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
        const existingLeadRow = await prisma.lead.findFirst({
          where: { whatsapp: phone },
          include: {
            stage: { select: { slug: true } },
            student: { select: { id: true } },
          },
        });
        const existingLead = existingLeadRow
          ? {
              id: existingLeadRow.id,
              name: existingLeadRow.name,
              unitInterest: existingLeadRow.unitInterest,
              campaign: existingLeadRow.campaign,
              stageSlug: existingLeadRow.stage.slug,
              botconversaContactId: existingLeadRow.botconversaContactId,
              hasStudent: existingLeadRow.student !== null,
            }
          : null;
        const result = resolveLeadFromSubscriber({
          subscriber: sub,
          tagNames,
          existingLead,
          source: 'BotConversa (import)',
        });
        if (result.action === 'create') {
          const stageId = stageMap.get(result.data.stage) ?? novoLeadStageId!;
          const { stage: _slug, ...rest } = result.data;
          await prisma.lead.create({ data: { ...rest, stageId } });
          totalCreated += 1;
        } else if (result.action === 'update') {
          const stageId = stageMap.get(result.data.stage) ?? novoLeadStageId!;
          const { stage: _slug, ...rest } = result.data;
          await prisma.lead.update({ where: { id: result.leadId }, data: { ...rest, stageId } });
          totalUpdated += 1;
        } else if (result.reason === 'locked_by_student' && existingLead) {
          // Lead ja virou aluno; import nao mexe (Student manda) e audita.
          await prisma.auditLog.create({
            data: {
              actorType: 'system',
              entityType: 'lead',
              entityId: existingLead.id,
              action: 'stage.locked_by_student',
              before: { stage: existingLead.stageSlug },
              after: { reason: 'student_vinculado', source: 'import-botconversa' },
            },
          });
        }
      }

      totalProcessed += 1;
    }

    if (!page.next) break;
    pageNum += 1;
    // 100ms entre paginas: dentro do rate limit (600 RPM) e gentil com a API.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n=== RESULTADO ===');
  console.log(`processados: ${totalProcessed}`);
  if (!DRY_RUN) {
    console.log(`criados: ${totalCreated}, atualizados: ${totalUpdated}`);
  }
  console.log(`pulados (sem telefone): ${totalSkipped}`);

  console.log('\nDistribuicao por stage:');
  for (const [stageName, count] of Object.entries(stageCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${stageName.padEnd(24)} ${count}`);
  }

  console.log('\nDistribuicao por unidade:');
  for (const [unitName, count] of Object.entries(unitCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${unitName.padEnd(24)} ${count}`);
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
