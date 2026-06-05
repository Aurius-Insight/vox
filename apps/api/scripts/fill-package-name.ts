// Preenche packageName = "Pacote 15 aulas" nos alunos matriculados ativos que
// estao sem pacote (artefato do import). NAO toca no saldo. Existe um unico
// pacote na Vox, entao todo matriculado esta nele.
//
// READ-ONLY por padrao (dry-run): so imprime o plano. APPLY=1 efetiva.
// Reversivel: cada alteracao grava auditLog 'student.package_filled' com o
// packageName anterior (null) em `before`.
import { prisma } from '../src/db/client.js';

const APPLY = process.env.APPLY === '1';
const PACKAGE_NAME = 'Pacote 15 aulas';

async function main() {
  const targets = await prisma.student.findMany({
    where: { active: true, type: 'matriculado', packageName: null },
    select: { id: true, name: true, creditBalance: true },
  });

  console.log(`\nMatriculados ativos sem packageName: ${targets.length}`);
  console.log(`  -> packageName = "${PACKAGE_NAME}" (saldo intacto)`);

  if (targets.length === 0 || !APPLY) {
    if (targets.length > 0) console.log('\n[DRY-RUN] nada foi escrito. Rode com APPLY=1 para efetivar.\n');
    return;
  }

  console.log('\n[APPLY] efetivando...');
  for (const s of targets) {
    await prisma.$transaction([
      prisma.student.update({ where: { id: s.id }, data: { packageName: PACKAGE_NAME } }),
      prisma.auditLog.create({
        data: {
          actorType: 'system',
          entityType: 'student',
          entityId: s.id,
          action: 'student.package_filled',
          before: { packageName: null },
          after: { packageName: PACKAGE_NAME, reason: 'pacote_padrao_unico' },
        },
      }),
    ]);
  }
  console.log(`[APPLY] concluido: ${targets.length} alunos.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
