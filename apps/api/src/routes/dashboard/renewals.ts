import { prisma } from '../../db/client.js';

// Renovacoes vem do AuditLog (action='student.renewed'). Cada entrada tem
// o pacote/preco no `after`. Comparativo mes corrente vs mes anterior +
// ticket medio (priceCents do pacote no momento da renovacao).
//
// O filtro de unidade exige resolver o Student vinculado a cada audit log
// — nem todo AuditLog tem entityType student exposto. Fazemos um SELECT
// secundario por studentId quando ha unitId no filtro.
export async function computeRenewals({ unitId }: { unitId?: string }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const logs = await prisma.auditLog.findMany({
    where: { action: 'student.renewed', createdAt: { gte: startOfPrev } },
    select: { entityId: true, createdAt: true, after: true },
  });

  // Filtro por unidade: precisa cruzar com Student.unitId. So roda quando
  // ha unitId — payload pequeno (dezenas por mes tipicamente).
  let allowed: Set<string> | null = null;
  if (unitId && logs.length > 0) {
    const studentIds = logs.map((l) => l.entityId);
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds }, unitId },
      select: { id: true },
    });
    allowed = new Set(students.map((s) => s.id));
  }

  const inMonth = (ts: Date, start: Date, end: Date) => ts >= start && ts < end;
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  let thisMonth = 0;
  let lastMonth = 0;
  let totalTicketCents = 0;
  let ticketCount = 0;

  for (const log of logs) {
    if (allowed && !allowed.has(log.entityId)) continue;
    const after = log.after as { priceCents?: number } | null;
    const price = after?.priceCents ?? 0;
    if (inMonth(log.createdAt, startOfMonth, endOfMonth)) {
      thisMonth += 1;
      totalTicketCents += price;
      ticketCount += 1;
    } else if (inMonth(log.createdAt, startOfPrev, startOfMonth)) {
      lastMonth += 1;
    }
  }

  return {
    thisMonth,
    lastMonth,
    avgTicketCents: ticketCount === 0 ? 0 : Math.round(totalTicketCents / ticketCount),
  };
}
