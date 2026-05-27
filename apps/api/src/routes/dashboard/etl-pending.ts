import { prisma } from '../../db/client.js';

// Pendencias da absorcao das planilhas:
//  - studentsWithoutWhatsapp: alunos importados pelo ETL ainda sem fone.
//  - datesAmbiguous: ate o operador validar as datas Catete (US vs BR)
//    nao temos como contar via DB — esse numero veio do dry-run (398).
//    Pra dashboard, deixamos hard-coded enquanto nao houver tabela de
//    revisao persistida. Quando o operador resolver pela UI, vamos
//    capturar o estado real.
//
// O numero 398 e tracking-only (snapshot do dry-run do F3). Se o
// operador validar uma datas via UI/script, atualizar este modulo.
const CATETE_AMBIGUOUS_DATES_SNAPSHOT = 398;

export async function computeEtlPending() {
  const [studentsWithoutWhatsapp, studentsFromEtl] = await Promise.all([
    prisma.student.count({
      where: { active: true, whatsapp: null },
    }),
    prisma.student.count({
      where: { active: true, lead: { source: 'planilha_legado' } },
    }),
  ]);

  return {
    studentsWithoutWhatsapp,
    studentsFromEtl,
    datesAmbiguous: CATETE_AMBIGUOUS_DATES_SNAPSHOT,
  };
}
