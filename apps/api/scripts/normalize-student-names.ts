// Normaliza nomes de Students que estao 100% em caixa alta ou 100% em
// caixa baixa para Title Case com conectores em pt-br ("de", "da", "do",
// "dos", "das", "e", "di", "du") em minusculas (exceto na primeira
// posicao). Nomes ja com mix de caixa (Title Case ou similar) ficam
// intocados — assume que ja estao no formato desejado.
//
// Dry-run por default; rode com --apply pra commitar no banco.
//
//   npx tsx scripts/normalize-student-names.ts
//   npx tsx scripts/normalize-student-names.ts --apply
//
// AuditLog: cria entrada `student.name_normalized` pra cada update,
// pra dar pra reverter caso a caso se algum nome ficar errado.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const APPLY = process.argv.includes('--apply');

// Conectores em pt-br que ficam minusculos no meio do nome. Lista curta —
// se aparecer algo fora dela, cai no Title Case padrao.
const LOWERCASE_CONNECTORS = new Set([
  'de', 'da', 'do', 'dos', 'das',
  'e',
  'di', 'du',
  'del', 'la', 'le',
]);

// Title-case com tratamento de conector. Mantem hifen e apostrofo.
function toTitleCase(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;

  const words = trimmed.toLowerCase().split(' ');
  return words
    .map((word, idx) => {
      if (idx > 0 && LOWERCASE_CONNECTORS.has(word)) return word;
      // Trata composicoes com hifen (Jean-Paul -> Jean-Paul) e
      // apostrofo (D'almeida -> D'Almeida).
      return word
        .split(/([-'])/)
        .map((piece) => {
          if (piece === '-' || piece === "'") return piece;
          if (!piece) return piece;
          return piece[0].toUpperCase() + piece.slice(1);
        })
        .join('');
    })
    .join(' ');
}

function hasLetters(s: string): boolean {
  return /[A-Za-zÀ-ÿ]/.test(s);
}

function isAllUpper(s: string): boolean {
  return hasLetters(s) && s === s.toUpperCase();
}

function isAllLower(s: string): boolean {
  return hasLetters(s) && s === s.toLowerCase();
}

async function main() {
  console.log(`[normalize-names] modo: ${APPLY ? 'APPLY (escreve no banco)' : 'DRY-RUN'}`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL nao definido.');
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const students = await prisma.student.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const changes: Array<{ id: string; from: string; to: string }> = [];
    for (const s of students) {
      if (!isAllUpper(s.name) && !isAllLower(s.name)) continue;
      const normalized = toTitleCase(s.name);
      if (normalized === s.name) continue;
      changes.push({ id: s.id, from: s.name, to: normalized });
    }

    console.log(`[normalize-names] ${students.length} alunos ativos.`);
    console.log(`[normalize-names] ${changes.length} candidatos a normalizar.`);
    console.log('');

    // Mostra os primeiros 20 antes-depois pra revisao.
    const preview = changes.slice(0, 20);
    if (preview.length > 0) {
      console.log('Preview (primeiros 20):');
      for (const c of preview) {
        console.log(`  "${c.from}"  ->  "${c.to}"`);
      }
      if (changes.length > preview.length) {
        console.log(`  ... + ${changes.length - preview.length} mais`);
      }
    }

    if (!APPLY) {
      console.log('');
      console.log('Sem flag --apply, nada foi escrito.');
      return;
    }

    console.log('');
    console.log('Aplicando...');
    let applied = 0;
    for (const c of changes) {
      await prisma.$transaction([
        prisma.student.update({
          where: { id: c.id },
          data: { name: c.to },
        }),
        prisma.auditLog.create({
          data: {
            actorType: 'system',
            entityType: 'student',
            entityId: c.id,
            action: 'student.name_normalized',
            before: { name: c.from },
            after: { name: c.to },
          },
        }),
      ]);
      applied += 1;
    }
    console.log(`Aplicado: ${applied}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main().catch((err) => {
  console.error('[normalize-names] FALHOU:', err);
  process.exit(1);
});
