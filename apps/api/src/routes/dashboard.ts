import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

const QuerySchema = z.object({
  unitId: z.string().max(120).optional(),
});

function percentage(part: number, total: number) {
  return total === 0 ? 0 : Number(((part / total) * 100).toFixed(1));
}

router.get(
  '/',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const query = QuerySchema.parse(req.query);
    const unitId = query.unitId && query.unitId !== 'todas' ? query.unitId : undefined;

    // Filtro por unidade. Dados operacionais (aulas, alunos, presenca) usam o
    // unitId. Leads nao tem FK para Unit — so o campo de texto livre
    // `unitInterest` — entao filtram por match exato do nome (leadWhere abaixo),
    // igual a aba por unidade da pagina de Vendas.
    const classWhere = unitId ? { unitId } : {};
    const studentWhere = unitId
      ? { active: true, type: 'matriculado' as const, unitId }
      : { active: true, type: 'matriculado' as const };
    const classRelationFilter = unitId ? { classSession: { unitId } } : {};

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const availableUnits = await prisma.unit.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    // Leads filtram pelo nome da unidade (texto livre em `unitInterest`).
    const selectedUnit = unitId
      ? availableUnits.find((unit) => unit.id === unitId)
      : undefined;
    const leadWhere = selectedUnit ? { unitInterest: selectedUnit.name } : {};

    const [
      totalLeads,
      enrolled,
      byStageRaw,
      byCampaignRaw,
      classAggregates,
      bookedCount,
      experimentalBookings,
      consumedThisMonth,
      studentsTotal,
      studentsWithoutBalance,
      activeStudentRows,
      presentCount,
      noShowCount,
    ] = await Promise.all([
      prisma.lead.count({ where: leadWhere }),
      // "Conversao" agora e qualquer etapa marcada como kind='won' — assim
      // se um dia criar `matriculado_promo` ou similar, ela e absorvida.
      prisma.lead.count({ where: { stage: { kind: 'won' }, ...leadWhere } }),
      prisma.lead.groupBy({ by: ['stageId'], where: leadWhere, _count: true }),
      prisma.lead.groupBy({
        by: ['campaign'],
        where: { campaign: { not: null }, ...leadWhere },
        _count: true,
      }),
      prisma.classSession.aggregate({ where: classWhere, _sum: { capacity: true } }),
      prisma.classBooking.count({ where: { status: 'agendado', ...classRelationFilter } }),
      prisma.classBooking.count({
        where: { status: 'agendado', type: 'experimental', ...classRelationFilter },
      }),
      prisma.attendance.count({
        where: { creditConsumed: true, markedAt: { gte: startOfMonth }, ...classRelationFilter },
      }),
      prisma.student.count({ where: studentWhere }),
      prisma.student.count({ where: { ...studentWhere, creditBalance: { lte: 0 } } }),
      prisma.attendance.findMany({
        where: { status: 'presente', markedAt: { gte: sixtyDaysAgo }, ...classRelationFilter },
        distinct: ['studentId'],
        select: { studentId: true },
      }),
      prisma.attendance.count({ where: { status: 'presente', ...classRelationFilter } }),
      prisma.attendance.count({ where: { status: 'no_show', ...classRelationFilter } }),
    ]);

    const totalCapacity = classAggregates._sum.capacity ?? 0;

    // Resolve stageId -> slug pra preservar o contrato { stage: slug }
    // que o front ja consome no card "Leads por etapa".
    const stages = await prisma.leadStage.findMany({
      where: { id: { in: byStageRaw.map((r) => r.stageId) } },
      select: { id: true, slug: true },
    });
    const slugById = new Map(stages.map((s) => [s.id, s.slug]));

    res.json({
      data: {
        unitId: unitId ?? 'todas',
        availableUnits,
        leads: {
          total: totalLeads,
          byStage: byStageRaw.map((row) => ({
            stage: slugById.get(row.stageId) ?? 'desconhecido',
            count: row._count,
          })),
          byCampaign: byCampaignRaw
            .map((row) => ({ campaign: row.campaign ?? 'Sem campanha', count: row._count }))
            .sort((a, b) => b.count - a.count),
        },
        sales: {
          enrolled,
          conversionRate: percentage(enrolled, totalLeads),
        },
        classes: {
          occupancy: percentage(bookedCount, totalCapacity),
          experimentalBookings,
          consumedThisMonth,
        },
        students: {
          total: studentsTotal,
          active: activeStudentRows.length,
          withoutBalance: studentsWithoutBalance,
        },
        attendance: {
          rate: percentage(presentCount, presentCount + noShowCount),
        },
      },
    });
  }),
);

export default router;
