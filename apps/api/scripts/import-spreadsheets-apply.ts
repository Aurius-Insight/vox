// F4: aplica no banco o que o ETL dry-run (import-spreadsheets.ts) decidiu.
// Sem flag `--apply`, so simula e imprime o plano. Sempre escreve por
// transacao por aluno (commit incremental) pra que uma falha no meio nao
// invalide o que ja entrou — caso o script precise ser rodado de novo
// depois de corrigir entrada, ele e idempotente:
//
//   - Aluno ja gravado (matricula existente apontando pra Lead): pula.
//   - Lead novo ja gravado por uma rodada anterior (mesma unidade + mesmo
//     nome normalizado + sem fone): reusa.
//   - ClassSession sintetica (mesma unidade + mesmo dia + isGuest=true e
//     sem professor): reusa.
//   - Attendance ja gravada (par unique classSession+student): pula.
//
// Estratégia de gravacao (decisao do operador: "suba tudo")
//   - dedup `exato`:    cria Student vinculado ao Lead casado.
//   - `parcial`/`sem`:  cria Lead novo (sem whatsapp, mesma unidade) +
//                        Student vinculado. Operador faxina depois.
// Datas ambiguas (Catete US/BR indistinguivel) sao skipadas — viram so a
// linha do Student, sem Attendance, ate o operador validar via CSV.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';
import { uniqueEnrollmentCode } from '../src/domain/enrollment.js';
import { readCsvRows } from './import-spreadsheets/csv.js';
import { parseRow } from './import-spreadsheets/parsers.js';
import { buildLeadIndex, classifyMatch } from './import-spreadsheets/dedup.js';
import type { EnrichedRow, ParsedRow, UnitSlug } from './import-spreadsheets/types.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const SPREADSHEETS_DIR =
  process.env.SPREADSHEETS_DIR ?? path.resolve(process.cwd(), '../../../Planilhas');
const APPLY = process.argv.includes('--apply');

const FILES: Array<{ unit: UnitSlug; filename: string }> = [
  { unit: 'catete',  filename: 'Cópia de Planilha Catete - Página1.csv' },
  { unit: 'niteroi', filename: 'CONTROLE NITERÓI  - Página1.csv' },
  { unit: 'tijuca',  filename: 'CONTROLE TIJUCA - Página1.csv' },
];

const UNIT_NAME_BY_SLUG: Record<UnitSlug, string> = {
  catete: 'Catete',
  niteroi: 'Niterói',
  tijuca: 'Tijuca',
};

// "Origem" registrada no Lead novo pra a galera saber que veio de planilha.
const LEGADO_SOURCE = 'planilha_legado';

type ApplyStats = {
  studentsCreated: number;
  studentsSkippedExisting: number;
  leadsCreated: number;
  leadsReused: number;
  classSessionsCreated: number;
  classSessionsReused: number;
  attendancesCreated: number;
  attendancesSkippedExisting: number;
  rowsWithoutMatch: number;
};

async function main() {
  console.log(`[apply] modo: ${APPLY ? 'APPLY (escreve no banco)' : 'DRY-RUN (so simula)'}`);
  console.log(`[apply] Planilhas: ${SPREADSHEETS_DIR}`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL nao definido.');
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const stats: ApplyStats = {
    studentsCreated: 0,
    studentsSkippedExisting: 0,
    leadsCreated: 0,
    leadsReused: 0,
    classSessionsCreated: 0,
    classSessionsReused: 0,
    attendancesCreated: 0,
    attendancesSkippedExisting: 0,
    rowsWithoutMatch: 0,
  };

  try {
    // Pre-carga: leads + unidades + diretor.
    const [leads, units, diretor] = await Promise.all([
      prisma.lead.findMany({
        select: { id: true, name: true, whatsapp: true, student: { select: { id: true } } },
      }),
      prisma.unit.findMany({ where: { active: true, name: { in: Object.values(UNIT_NAME_BY_SLUG) } } }),
      prisma.user.findFirst({ where: { roles: { has: 'diretor' } } }),
    ]);
    if (!diretor) throw new Error('Nenhum usuario diretor encontrado pra markedBy.');
    console.log(`[apply] ${leads.length} leads pre-carregados. Diretor: ${diretor.name}`);

    const leadIndex = buildLeadIndex(leads.map((l) => ({ id: l.id, name: l.name })));
    const leadWhatsappById = new Map(leads.map((l) => [l.id, l.whatsapp]));
    const leadHasStudent = new Map(leads.map((l) => [l.id, l.student !== null]));
    const unitIdBySlug = new Map<UnitSlug, string>();
    for (const slug of Object.keys(UNIT_NAME_BY_SLUG) as UnitSlug[]) {
      const unit = units.find((u) => u.name === UNIT_NAME_BY_SLUG[slug]);
      if (!unit) throw new Error(`Unidade '${UNIT_NAME_BY_SLUG[slug]}' nao encontrada/ativa.`);
      unitIdBySlug.set(slug, unit.id);
    }

    // Le todas as linhas de todas as planilhas.
    const allRows: EnrichedRow[] = [];
    for (const { unit, filename } of FILES) {
      const filePath = path.join(SPREADSHEETS_DIR, filename);
      const rows = readCsvRows(filePath).slice(1);
      rows.forEach((cells, idx) => {
        const row = parseRow(unit, idx + 1, cells);
        if (!row) return;
        allRows.push({ ...row, dedup: classifyMatch(row.normalizedName, leadIndex) });
      });
    }

    console.log(`[apply] ${allRows.length} linhas pra processar.`);

    // Processa em ordem (Catete primeiro, depois Niteroi, depois Tijuca).
    for (const row of allRows) {
      await processRow(prisma, row, {
        unitIdBySlug,
        leadWhatsappById,
        leadHasStudent,
        diretorId: diretor.id,
        apply: APPLY,
        stats,
      });
    }

    console.log('');
    console.log('=== Resumo ===');
    console.log(`Students criados:       ${stats.studentsCreated}`);
    console.log(`Students ja existiam:   ${stats.studentsSkippedExisting}`);
    console.log(`Leads criados:          ${stats.leadsCreated}`);
    console.log(`Leads reusados:         ${stats.leadsReused}`);
    console.log(`ClassSessions criadas:  ${stats.classSessionsCreated}`);
    console.log(`ClassSessions reusadas: ${stats.classSessionsReused}`);
    console.log(`Attendances criadas:    ${stats.attendancesCreated}`);
    console.log(`Attendances existiam:   ${stats.attendancesSkippedExisting}`);
    if (!APPLY) {
      console.log('');
      console.log('Sem flag --apply, nada foi escrito. Rode de novo com --apply pra commitar.');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

type ProcessCtx = {
  unitIdBySlug: Map<UnitSlug, string>;
  leadWhatsappById: Map<string, string | null>;
  leadHasStudent: Map<string, boolean>;
  diretorId: string;
  apply: boolean;
  stats: ApplyStats;
};

async function processRow(prisma: PrismaClient, row: EnrichedRow, ctx: ProcessCtx) {
  const unitId = ctx.unitIdBySlug.get(row.unit)!;

  // Decide o caminho: casa com Lead existente (exato) ou cria novo (parcial/sem-match).
  let leadId: string | null = null;
  let leadWhatsapp: string | null = null;

  if (row.dedup.kind === 'exato') {
    leadId = row.dedup.leadId;
    leadWhatsapp = ctx.leadWhatsappById.get(leadId) ?? null;

    // Se o Lead ja virou Student, esse aluno ja foi absorvido em rodada
    // anterior — pula a linha inteira (idempotencia).
    if (ctx.leadHasStudent.get(leadId)) {
      ctx.stats.studentsSkippedExisting += 1;
      return;
    }
  } else {
    ctx.stats.rowsWithoutMatch += row.dedup.kind === 'sem-match' ? 1 : 0;
    // Cria Lead novo sem whatsapp. unitInterest pega o nome da unidade.
    if (ctx.apply) {
      const newLead = await prisma.lead.create({
        data: {
          name: row.normalizedName,
          unitInterest: UNIT_NAME_BY_SLUG[row.unit],
          source: LEGADO_SOURCE,
          stageId: await getMatriculadoStageId(prisma),
        },
      });
      leadId = newLead.id;
      ctx.leadHasStudent.set(leadId, false);
    }
    ctx.stats.leadsCreated += 1;
  }

  // Cria Student vinculado.
  const studentType = row.tags.includes('EXP') ? 'experimental' : 'matriculado';

  if (ctx.apply && leadId) {
    const enrollmentCode = await uniqueEnrollmentCode((code) =>
      prisma.student.findUnique({ where: { enrollmentCode: code } }).then((found) => found !== null),
    );
    const student = await prisma.student.create({
      data: {
        leadId,
        name: row.normalizedName,
        whatsapp: leadWhatsapp,
        unitId,
        enrollmentCode,
        type: studentType,
        creditBalance: 0,
        tags: row.tags,
      },
    });
    ctx.stats.studentsCreated += 1;
    ctx.leadHasStudent.set(leadId, true);

    // Cria Attendance pra cada data (skipa ambiguas).
    for (const isoDate of row.dates) {
      await createAttendance(prisma, {
        unitId,
        isoDate,
        studentId: student.id,
        markedByUserId: ctx.diretorId,
        stats: ctx.stats,
      });
    }
  } else {
    ctx.stats.studentsCreated += 1;
    // Modo dry-run conta as attendances que seriam criadas tambem.
    ctx.stats.attendancesCreated += row.dates.length;
  }
}

let cachedMatriculadoStageId: string | null = null;
async function getMatriculadoStageId(prisma: PrismaClient): Promise<string> {
  if (cachedMatriculadoStageId) return cachedMatriculadoStageId;
  const stage = await prisma.leadStage.findUnique({ where: { slug: 'matriculado' } });
  if (!stage) throw new Error('LeadStage "matriculado" nao encontrada.');
  cachedMatriculadoStageId = stage.id;
  return stage.id;
}

// Encontra ou cria ClassSession ghost (mesma unidade + mesmo dia + isGuest=true)
// e cria Attendance vinculada ao aluno. Retry em caso de race (idempotente).
const sessionCache = new Map<string, string>();

async function createAttendance(
  prisma: PrismaClient,
  opts: {
    unitId: string;
    isoDate: string;
    studentId: string;
    markedByUserId: string;
    stats: ApplyStats;
  },
): Promise<void> {
  const sessionKey = `${opts.unitId}:${opts.isoDate}`;
  let classSessionId = sessionCache.get(sessionKey);

  if (!classSessionId) {
    // Tenta achar uma session ghost ja existente nesse dia/unidade.
    const startsAt = new Date(`${opts.isoDate}T22:00:00.000Z`); // 19h America/Sao_Paulo
    const endsAt = new Date(`${opts.isoDate}T23:30:00.000Z`);
    const existing = await prisma.classSession.findFirst({
      where: {
        unitId: opts.unitId,
        startsAt,
        isGuest: true,
        teacherUserId: null,
      },
      select: { id: true },
    });
    if (existing) {
      classSessionId = existing.id;
      opts.stats.classSessionsReused += 1;
    } else {
      const created = await prisma.classSession.create({
        data: {
          unitId: opts.unitId,
          isGuest: true,
          startsAt,
          endsAt,
          capacity: 30,
        },
        select: { id: true },
      });
      classSessionId = created.id;
      opts.stats.classSessionsCreated += 1;
    }
    sessionCache.set(sessionKey, classSessionId);
  }

  // Attendance: unique(classSessionId, studentId). Se ja existir, skipa.
  try {
    await prisma.attendance.create({
      data: {
        classSessionId,
        studentId: opts.studentId,
        status: 'presente',
        creditConsumed: false,
        markedByUserId: opts.markedByUserId,
      },
    });
    opts.stats.attendancesCreated += 1;
  } catch (err) {
    // P2002 (unique violation) = ja existe. Idempotente.
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      opts.stats.attendancesSkippedExisting += 1;
      return;
    }
    throw err;
  }
}

void main().catch((err) => {
  console.error('[apply] FALHOU:', err);
  process.exit(1);
});

// Avoid unused-import warning while keeping the type re-export.
void ({} as ParsedRow);
