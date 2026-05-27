import { prisma } from '../../db/client.js';

// Rankings comparativos: escola, materia, pacote. Quando o filtro de unidade
// esta ativo, os rankings de materia/pacote respeitam o filtro; o ranking
// por escola sempre devolve todas as escolas (preserva o comparativo).
export async function computeRankings({ unitId }: { unitId?: string }) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [units, subjects, packages, studentsByUnit, classesByUnit] = await Promise.all([
    prisma.unit.findMany({ where: { active: true }, select: { id: true, name: true } }),
    prisma.subject.findMany({ where: { active: true }, select: { id: true, name: true } }),
    prisma.package.findMany({
      where: { active: true },
      select: { id: true, name: true, classCount: true, priceCents: true },
    }),
    prisma.student.groupBy({
      by: ['unitId'],
      where: { active: true, type: 'matriculado' },
      _count: true,
    }),
    prisma.classSession.groupBy({
      by: ['unitId'],
      where: { canceledAt: null, startsAt: { gte: startOfMonth } },
      _count: true,
    }),
  ]);

  // Attendances do mes com include do unit+subject — uma query so, agregado
  // em memoria. Volume tipico: ~milhares por mes; cabe.
  const attendancesThisMonth = await prisma.attendance.findMany({
    where: { markedAt: { gte: startOfMonth } },
    select: {
      status: true,
      studentId: true,
      classSession: { select: { unitId: true, subjectId: true } },
    },
  });

  const studentByUnit = new Map(studentsByUnit.map((r) => [r.unitId ?? '', r._count]));
  const classesByUnitMap = new Map(classesByUnit.map((r) => [r.unitId ?? '', r._count]));

  // Por escola: presentes/faltas pra calcular taxa de presenca.
  const unitStats = new Map<string, { presente: number; noShow: number }>();
  for (const att of attendancesThisMonth) {
    const key = att.classSession.unitId ?? '';
    const bucket = unitStats.get(key) ?? { presente: 0, noShow: 0 };
    if (att.status === 'presente') bucket.presente += 1;
    else bucket.noShow += 1;
    unitStats.set(key, bucket);
  }

  const byUnit = units
    .map((unit) => {
      const stats = unitStats.get(unit.id) ?? { presente: 0, noShow: 0 };
      const total = stats.presente + stats.noShow;
      return {
        unitId: unit.id,
        unitName: unit.name,
        students: studentByUnit.get(unit.id) ?? 0,
        classesThisMonth: classesByUnitMap.get(unit.id) ?? 0,
        attendanceRate: total === 0 ? 0 : Number(((stats.presente / total) * 100).toFixed(1)),
      };
    })
    .sort((a, b) => b.students - a.students);

  // Por materia (filtro de unidade respeitado): alunos distintos + total de
  // presencas marcadas no mes. Reflete o que esta sendo consumido.
  const subjectStudents = new Map<string, Set<string>>();
  const subjectAttendances = new Map<string, number>();
  for (const att of attendancesThisMonth) {
    if (unitId && att.classSession.unitId !== unitId) continue;
    if (att.status !== 'presente') continue;
    const sid = att.classSession.subjectId;
    if (!sid) continue;
    if (!subjectStudents.has(sid)) subjectStudents.set(sid, new Set());
    subjectStudents.get(sid)!.add(att.studentId);
    subjectAttendances.set(sid, (subjectAttendances.get(sid) ?? 0) + 1);
  }
  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));
  const bySubject = [...subjectStudents.entries()]
    .map(([subjectId, studentSet]) => ({
      subjectId,
      subjectName: subjectNameById.get(subjectId) ?? 'Desconhecida',
      students: studentSet.size,
      attendances: subjectAttendances.get(subjectId) ?? 0,
    }))
    .sort((a, b) => b.students - a.students);

  // Distribuicao por pacote + projecao de receita. priceCents do Package
  // atual * count — proxy simples (ignora descontos historicos).
  const packageByName = new Map(packages.map((p) => [p.name, p]));
  const studentsByPackage = await prisma.student.groupBy({
    by: ['packageName'],
    where: {
      active: true,
      type: 'matriculado',
      ...(unitId ? { unitId } : {}),
      packageName: { not: null },
    },
    _count: true,
  });
  const byPackage = studentsByPackage
    .map((row) => {
      const pkg = packageByName.get(row.packageName ?? '');
      const studentCount = row._count;
      return {
        name: row.packageName ?? 'Sem pacote',
        studentCount,
        priceCents: pkg?.priceCents ?? 0,
        revenueProjectionCents: (pkg?.priceCents ?? 0) * studentCount,
      };
    })
    .sort((a, b) => b.studentCount - a.studentCount);

  return { byUnit, bySubject, byPackage };
}
