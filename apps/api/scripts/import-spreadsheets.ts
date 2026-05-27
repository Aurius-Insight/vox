// ETL dry-run das 3 planilhas operacionais (Catete, Niteroi, Tijuca).
//
// Esse script *nao escreve no banco*. Le os CSVs locais, parseia nomes,
// tags e datas conforme convencao de cada unidade, faz dedup contra a
// tabela Lead e produz 3 CSVs de revisao em scripts/output/:
//
//   - revisao_match_parcial.csv  -> alunos com similaridade alta mas nao
//     identica com algum Lead; operador escolhe casar ou criar novo.
//   - revisao_celulas_invalidas.csv -> celulas que nao deram parse (notas
//     livres, datas malformadas, EXP solto, telefone misturado).
//   - revisao_fev_counter.csv -> Niteroi: linhas com numero solto na col
//     FEV; precisamos entender o que esse contador significa antes de
//     transformar em backfill de presencas.
//
// Tambem imprime um sumario no stdout. Rode com:
//   pnpm --filter @vox/api tsx scripts/import-spreadsheets.ts
//
// Caminho dos CSVs e fixado pra arvore do projeto (../Planilhas), mas
// pode ser sobrescrito via SPREADSHEETS_DIR.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';
import { readCsvRows, writeCsv } from './import-spreadsheets/csv.js';
import { parseRow } from './import-spreadsheets/parsers.js';
import { buildLeadIndex, classifyMatch } from './import-spreadsheets/dedup.js';
import type {
  EnrichedRow,
  ImportSummary,
  ParsedRow,
  UnitSlug,
} from './import-spreadsheets/types.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const SPREADSHEETS_DIR =
  process.env.SPREADSHEETS_DIR ?? path.resolve(process.cwd(), '../../../Planilhas');
const OUTPUT_DIR = path.resolve(process.cwd(), 'scripts/output');

const FILES: Array<{ unit: UnitSlug; filename: string }> = [
  { unit: 'catete',  filename: 'Cópia de Planilha Catete - Página1.csv' },
  { unit: 'niteroi', filename: 'CONTROLE NITERÓI  - Página1.csv' },
  { unit: 'tijuca',  filename: 'CONTROLE TIJUCA - Página1.csv' },
];

async function main() {
  console.log(`[etl] Planilhas em: ${SPREADSHEETS_DIR}`);
  console.log(`[etl] Output em:    ${OUTPUT_DIR}`);
  console.log('');

  // Conexao read-only ao Postgres para puxar Leads ja existentes.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL nao definido. Rodando local? Verifique o .env');
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const leads = await prisma.lead.findMany({ select: { id: true, name: true } });
    console.log(`[etl] ${leads.length} leads carregados pra dedup.`);
    const leadIndex = buildLeadIndex(leads);

    const allRows: EnrichedRow[] = [];
    const summaries: ImportSummary[] = [];

    for (const { unit, filename } of FILES) {
      const filePath = path.join(SPREADSHEETS_DIR, filename);
      const rows = readCsvRows(filePath);
      // Skip header (linha 0).
      const dataRows = rows.slice(1);

      const parsed: ParsedRow[] = [];
      dataRows.forEach((cells, idx) => {
        const row = parseRow(unit, idx + 1, cells);
        if (row) parsed.push(row);
      });

      const enriched: EnrichedRow[] = parsed.map((row) => ({
        ...row,
        dedup: classifyMatch(row.normalizedName, leadIndex),
      }));
      allRows.push(...enriched);

      summaries.push(summarize(unit, enriched));
    }

    writeReviewFiles(allRows);
    printSummary(summaries);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

function summarize(unit: UnitSlug, rows: EnrichedRow[]): ImportSummary {
  return {
    unit,
    totalRows: rows.length,
    totalDates: rows.reduce((sum, r) => sum + r.dates.length, 0),
    totalAmbiguousDates: rows.reduce((sum, r) => sum + r.ambiguousDates.length, 0),
    totalInvalidCells: rows.reduce((sum, r) => sum + r.invalidCells.length, 0),
    byDedup: {
      exato:    rows.filter((r) => r.dedup.kind === 'exato').length,
      parcial:  rows.filter((r) => r.dedup.kind === 'parcial').length,
      semMatch: rows.filter((r) => r.dedup.kind === 'sem-match').length,
    },
  };
}

function writeReviewFiles(rows: EnrichedRow[]) {
  // 1) Matches parciais — operador decide casar/criar.
  const partialRows = rows
    .filter((r) => r.dedup.kind === 'parcial')
    .map((r) => {
      const dedup = r.dedup as Extract<EnrichedRow['dedup'], { kind: 'parcial' }>;
      return [
        r.unit,
        String(r.rowIndex),
        r.rawName,
        r.normalizedName,
        dedup.leadName,
        dedup.leadId,
        String(dedup.similarity),
        r.tags.join('|'),
        String(r.dates.length),
      ];
    });
  writeCsv(
    path.join(OUTPUT_DIR, 'revisao_match_parcial.csv'),
    ['unidade', 'linha', 'nome_planilha', 'nome_normalizado', 'lead_nome', 'lead_id', 'similaridade', 'tags', 'qtd_aulas'],
    partialRows,
  );

  // 2) Celulas invalidas (texto livre, datas malformadas, ruido).
  const invalidRows: string[][] = [];
  for (const row of rows) {
    for (const cell of row.invalidCells) {
      invalidRows.push([
        row.unit,
        String(row.rowIndex),
        row.rawName,
        String(cell.columnIndex),
        cell.sourceText,
        cell.reason,
      ]);
    }
  }
  writeCsv(
    path.join(OUTPUT_DIR, 'revisao_celulas_invalidas.csv'),
    ['unidade', 'linha', 'nome_planilha', 'coluna', 'texto', 'motivo'],
    invalidRows,
  );

  // 3) Contadores FEV (Niteroi) — precisamos entender semantica.
  const fevRows = rows
    .filter((r) => r.unit === 'niteroi' && r.fevCounter !== undefined)
    .map((r) => [
      String(r.rowIndex),
      r.rawName,
      String(r.fevCounter ?? ''),
      String(r.dates.length),
      r.dedup.kind,
    ]);
  writeCsv(
    path.join(OUTPUT_DIR, 'revisao_fev_counter.csv'),
    ['linha', 'nome_planilha', 'fev_counter', 'qtd_aulas', 'dedup'],
    fevRows,
  );

  // 4) Datas ambiguas (Catete US vs BR com ambos digitos <= 12).
  const ambiguousRows: string[][] = [];
  for (const row of rows) {
    for (const cell of row.ambiguousDates) {
      ambiguousRows.push([
        row.unit,
        String(row.rowIndex),
        row.rawName,
        String(cell.columnIndex),
        cell.sourceText,
        cell.isoDate,
      ]);
    }
  }
  writeCsv(
    path.join(OUTPUT_DIR, 'revisao_datas_ambiguas.csv'),
    ['unidade', 'linha', 'nome_planilha', 'coluna', 'texto_original', 'interpretacao_us'],
    ambiguousRows,
  );

  // 5) Bonus: csv completo das linhas com match exato (referencia rapida).
  const exactRows = rows
    .filter((r) => r.dedup.kind === 'exato')
    .map((r) => {
      const dedup = r.dedup as Extract<EnrichedRow['dedup'], { kind: 'exato' }>;
      return [
        r.unit,
        String(r.rowIndex),
        r.rawName,
        dedup.leadName,
        dedup.leadId,
        r.tags.join('|'),
        String(r.dates.length),
        String(r.ambiguousDates.length),
      ];
    });
  writeCsv(
    path.join(OUTPUT_DIR, 'absorvidos_exato.csv'),
    ['unidade', 'linha', 'nome_planilha', 'lead_nome', 'lead_id', 'tags', 'qtd_aulas', 'qtd_aulas_ambiguas'],
    exactRows,
  );

  // 5) Bonus: sem-match -> precisamos criar Lead+Student do zero.
  const orphanRows = rows
    .filter((r) => r.dedup.kind === 'sem-match')
    .map((r) => [
      r.unit,
      String(r.rowIndex),
      r.rawName,
      r.normalizedName,
      r.tags.join('|'),
      String(r.dates.length),
      String(r.ambiguousDates.length),
    ]);
  writeCsv(
    path.join(OUTPUT_DIR, 'novos_sem_match.csv'),
    ['unidade', 'linha', 'nome_planilha', 'nome_normalizado', 'tags', 'qtd_aulas', 'qtd_aulas_ambiguas'],
    orphanRows,
  );
}

function printSummary(summaries: ImportSummary[]) {
  console.log('');
  console.log('=== Sumario por unidade ===');
  for (const s of summaries) {
    console.log(`[${s.unit}] rows=${s.totalRows} datas=${s.totalDates} ambig=${s.totalAmbiguousDates} invalid=${s.totalInvalidCells}`);
    console.log(`   dedup: exato=${s.byDedup.exato} parcial=${s.byDedup.parcial} sem-match=${s.byDedup.semMatch}`);
  }
  const total = summaries.reduce(
    (acc, s) => ({
      rows: acc.rows + s.totalRows,
      dates: acc.dates + s.totalDates,
      ambig: acc.ambig + s.totalAmbiguousDates,
      invalid: acc.invalid + s.totalInvalidCells,
      exato: acc.exato + s.byDedup.exato,
      parcial: acc.parcial + s.byDedup.parcial,
      semMatch: acc.semMatch + s.byDedup.semMatch,
    }),
    { rows: 0, dates: 0, ambig: 0, invalid: 0, exato: 0, parcial: 0, semMatch: 0 },
  );
  console.log('');
  console.log(`TOTAL rows=${total.rows} datas=${total.dates} ambig=${total.ambig} invalid=${total.invalid}`);
  console.log(`TOTAL dedup: exato=${total.exato} parcial=${total.parcial} sem-match=${total.semMatch}`);
  console.log('');
  console.log(`Outputs em ${OUTPUT_DIR}:`);
  console.log('  - revisao_match_parcial.csv     (operador decide casar/criar)');
  console.log('  - revisao_celulas_invalidas.csv (texto livre, datas malformadas)');
  console.log('  - revisao_fev_counter.csv       (semantica do contador FEV)');
  console.log('  - absorvidos_exato.csv          (referencia rapida)');
  console.log('  - novos_sem_match.csv           (futuros Lead+Student novos)');
}

main().catch((err) => {
  console.error('[etl] FALHOU:', err);
  process.exit(1);
});
