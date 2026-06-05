// Backfill das etapas do CRM (Híbrido "Student manda"): alinha a etapa do lead
// de cada aluno ATIVO ao tipo dele —
//   matriculado  -> matriculado
//   experimental -> experimental_agendada
// Aluno ativo sem lead ganha um lead novo na etapa certa (vira visivel no CRM).
//
// READ-ONLY por padrao (dry-run): so imprime o plano. Rode com APPLY=1 para
// efetivar. Reversivel: cada alteracao gera um auditLog 'crm.stage_backfilled'
// com a etapa anterior em `before.stage` (null = lead criado agora).
//
// Uso (no servidor):
//   docker compose -f docker-compose.prod.yml exec -T api \
//     npx tsx apps/api/scripts/backfill-crm-stages.ts            # dry-run
//   ... APPLY=1 npx tsx apps/api/scripts/backfill-crm-stages.ts  # efetiva
import { prisma } from '../src/db/client.js';
import { enrollmentStageSlug } from '../src/domain/enrollment.js';

const APPLY = process.env.APPLY === '1';

type Move = { studentId: string; leadId: string; from: string; to: string };
type Create = { studentId: string; to: string };

async function main() {
  const stages = await prisma.leadStage.findMany({ select: { id: true, slug: true } });
  const idBySlug = new Map(stages.map((s) => [s.slug, s.id]));
  const slugById = new Map(stages.map((s) => [s.id, s.slug]));

  const students = await prisma.student.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      type: true,
      whatsapp: true,
      email: true,
      leadId: true,
      lead: { select: { stageId: true } },
      unit: { select: { name: true } },
    },
  });

  const moves: Move[] = [];
  const creates: Create[] = [];
  let aligned = 0;

  for (const st of students) {
    const targetSlug = enrollmentStageSlug(st.type);
    const targetId = idBySlug.get(targetSlug);
    if (!targetId) throw new Error(`Etapa "${targetSlug}" nao existe no banco.`);

    if (st.leadId && st.lead) {
      if (st.lead.stageId === targetId) {
        aligned += 1;
        continue;
      }
      moves.push({
        studentId: st.id,
        leadId: st.leadId,
        from: slugById.get(st.lead.stageId) ?? '?',
        to: targetSlug,
      });
    } else {
      creates.push({ studentId: st.id, to: targetSlug });
    }
  }

  const byTransition: Record<string, number> = {};
  for (const m of moves) {
    const key = `${m.from} -> ${m.to}`;
    byTransition[key] = (byTransition[key] ?? 0) + 1;
  }

  console.log(`\nAlunos ativos analisados: ${students.length}`);
  console.log(`  ja alinhados: ${aligned}`);
  console.log(`  mover lead p/ etapa correta: ${moves.length}`);
  console.log(`  criar lead (aluno sem lead): ${creates.length}`);
  console.log('\n  Transicoes (de -> para):');
  for (const [key, count] of Object.entries(byTransition).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${key}: ${count}`);
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] nada foi escrito. Rode com APPLY=1 para efetivar.\n');
    return;
  }

  console.log('\n[APPLY] efetivando...');
  for (const m of moves) {
    await prisma.$transaction([
      prisma.lead.update({ where: { id: m.leadId }, data: { stageId: idBySlug.get(m.to)! } }),
      prisma.auditLog.create({
        data: {
          actorType: 'system',
          entityType: 'lead',
          entityId: m.leadId,
          action: 'crm.stage_backfilled',
          before: { stage: m.from },
          after: { stage: m.to, studentId: m.studentId, reason: 'hibrido_student_manda' },
        },
      }),
    ]);
  }

  for (const c of creates) {
    const st = students.find((s) => s.id === c.studentId);
    if (!st) continue;
    await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          name: st.name,
          whatsapp: st.whatsapp,
          email: st.email,
          unitInterest: st.unit?.name ?? 'Importado',
          source: 'backfill_crm',
          stageId: idBySlug.get(c.to)!,
        },
        select: { id: true },
      });
      await tx.student.update({ where: { id: st.id }, data: { leadId: lead.id } });
      await tx.auditLog.create({
        data: {
          actorType: 'system',
          entityType: 'lead',
          entityId: lead.id,
          action: 'crm.stage_backfilled',
          before: { stage: null },
          after: { stage: c.to, studentId: st.id, reason: 'lead_criado_no_backfill' },
        },
      });
    });
  }

  console.log(`[APPLY] concluido: ${moves.length} leads movidos, ${creates.length} leads criados.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
