import type { ParsedRow, UnitSlug, CellOutcome } from './types.js';
import { extractTagsAndCleanName } from './name-normalizer.js';
import { parseCellCatete, parseCellNiteroi, parseCellTijuca } from './date-parser.js';

// Converte cada linha da planilha em ParsedRow. A coluna 0 e sempre o nome;
// o resto e celula de aula (ou contador FEV no caso da Niteroi).
export function parseRow(
  unit: UnitSlug,
  rowIndex: number,
  cells: string[],
): ParsedRow | null {
  const rawName = (cells[0] ?? '').trim();
  if (rawName === '') return null;

  const { name, tags } = extractTagsAndCleanName(rawName);
  const dates: string[] = [];
  const ambiguousDates: ParsedRow['ambiguousDates'] = [];
  const invalidCells: ParsedRow['invalidCells'] = [];
  let fevCounter: number | undefined;

  const parser = pickParser(unit);

  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i]?.trim() ?? '';

    // Niteroi: coluna 1 e FEV (contador). Se for so numero, captura.
    if (unit === 'niteroi' && i === 1 && /^\d{1,2}$/.test(cell)) {
      fevCounter = Number(cell);
      continue;
    }

    const outcome = parser(cell);
    if (!outcome) continue;

    if (outcome.kind === 'date') {
      if (outcome.ambiguous) {
        ambiguousDates.push({
          isoDate: outcome.isoDate,
          sourceText: outcome.sourceText,
          columnIndex: i,
        });
      } else {
        dates.push(outcome.isoDate);
      }
    } else {
      invalidCells.push({
        columnIndex: i,
        sourceText: outcome.sourceText,
        reason: outcome.reason,
      });
    }
  }

  return {
    unit,
    rowIndex,
    rawName,
    normalizedName: name,
    tags,
    dates,
    ambiguousDates,
    invalidCells,
    fevCounter,
  };
}

function pickParser(unit: UnitSlug): (cell: string) => CellOutcome | null {
  if (unit === 'catete') return parseCellCatete;
  if (unit === 'niteroi') return parseCellNiteroi;
  return parseCellTijuca;
}
