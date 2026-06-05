// Normaliza o saldo dos alunos com creditBalance > 15 (artefato do import):
// todo aluno parte do padrao de 15 aulas e o saldo vira 15 MENOS as aulas ja
// consumidas no historico (presencas). packageName passa a "Pacote 15 aulas".
//
// Escopo: alunos ATIVOS com creditBalance > 15 (so esses, por decisao do
// operador). Quem ja esta <= 15 nao e tocado.
//
// READ-ONLY por padrao (dry-run): so imprime o plano. APPLY=1 efetiva.
// Reversivel: cada alteracao grava auditLog 'student.credit_normalized' com
// creditBalance/packageName anteriores em `before`.
//
// Uso (no servidor):
//   docker compose -f docker-compose.prod.yml exec -T api \
//     npx tsx apps/api/scripts/normalize-credit-balances.ts            # dry-run
//   ... -e APPLY=1 ... npx tsx apps/api/scripts/normalize-credit-balances.ts
import { prisma } from '../src/db/client.js';

const APPLY = process.env.APPLY === '1';
const STANDARD = 15;
const PACKAGE_NAME = 'Pacote 15 aulas';

async function main() {
  const targets = await prisma.student.findMany({
    where: { active: true, creditBalance: { gt: STANDARD } },
    select: { id: true, name: true, creditBalance: true, packageName: true, type: true },
  });

  if (targets.length === 0) {
    console.log('\nNenhum aluno ativo com saldo > 15. Nada a fazer.\n');
    return;
  }

  const ids = targets.map((t) => t.id);
  const presences = await prisma.attendance.groupBy({
    by: ['studentId'],
    where: { studentId: { in: ids }, status: 'presente' },
    _count: { _all: true },
  });
  const presByStudent = new Map(presences.map((p) => [p.studentId, p._count._all]));

  const changes = targets.map((t) => {
    const consumed = presByStudent.get(t.id) ?? 0;
    const novo = Math.max(0, STANDARD - consumed);
    return { ...t, consumed, novo };
  });

  const naoMatriculado = changes.filter((c) => c.type !== 'matriculado');
  const zerados = changes.filter((c) => c.novo === 0);

  console.log(`\nAlunos ativos com saldo > ${STANDARD}: ${targets.length}`);
  console.log(`  novo saldo = max(0, ${STANDARD} - presencas); packageName = "${PACKAGE_NAME}"`);
  console.log(`  cairiam para 0 (presencas >= ${STANDARD}): ${zerados.length}`);
  if (naoMatriculado.length > 0) {
    console.log(`  ATENCAO: ${naoMatriculado.length} nao sao 'matriculado' (revisar antes).`);
  }

  console.log('\n  Amostra (saldo atual -> novo | presencas):');
  for (const c of [...changes].sort((a, b) => b.creditBalance - a.creditBalance).slice(0, 15)) {
    console.log(`    ${c.name}: ${c.creditBalance} -> ${c.novo} | ${c.consumed} presencas`);
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] nada foi escrito. Rode com APPLY=1 para efetivar.\n');
    return;
  }

  console.log('\n[APPLY] efetivando...');
  for (const c of changes) {
    await prisma.$transaction([
      prisma.student.update({
        where: { id: c.id },
        data: { creditBalance: c.novo, packageName: PACKAGE_NAME },
      }),
      prisma.auditLog.create({
        data: {
          actorType: 'system',
          entityType: 'student',
          entityId: c.id,
          action: 'student.credit_normalized',
          before: { creditBalance: c.creditBalance, packageName: c.packageName },
          after: {
            creditBalance: c.novo,
            packageName: PACKAGE_NAME,
            presencas: c.consumed,
            reason: 'padrao_15_menos_historico',
          },
        },
      }),
    ]);
  }
  console.log(`[APPLY] concluido: ${changes.length} alunos normalizados.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
