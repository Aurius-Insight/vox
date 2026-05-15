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

    // O filtro por unidade vale para os dados operacionais (aulas, alunos,
    // presenca). Leads ficam fora do filtro: `Lead.unitInterest` e texto livre
    // capturado da conversa, nao um vinculo formal com `Unit`.
    const classWhere = unitId ? { unitId } : {};
    const studentWhere = unitId ? { active: true, unitId } : { active: true };
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
      prisma.lead.count(),
      prisma.lead.count({ where: { stage: 'matriculado' } }),
      prisma.lead.groupBy({ by: ['stage'], _count: true }),
      prisma.lead.groupBy({
        by: ['campaign'],
        where: { campaign: { not: null } },
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

    res.json({
      data: {
        unitId: unitId ?? 'todas',
        availableUnits,
        leads: {
          total: totalLeads,
          byStage: byStageRaw.map((row) => ({ stage: row.stage, count: row._count })),
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
