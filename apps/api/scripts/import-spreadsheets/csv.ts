import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Leitor CSV minimo — as 3 planilhas nao tem aspas/escape (texto puro
// com virgulas). Quebra por \n, divide por virgula, trim leve.
export function readCsvRows(filePath: string): string[][] {
  const text = readFileSync(filePath, 'utf-8');
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.map((line) => line.split(',').map((cell) => cell.replace(/\s+$/, '')));
}

// Escreve linhas como CSV com cabecalho. Cuida do escape basico: se a
// celula tem virgula/aspas/newline, envolve em aspas e duplica as aspas.
export function writeCsv(filePath: string, header: string[], rows: string[][]): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const lines = [header, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\n');
  writeFileSync(filePath, lines + '\n', 'utf-8');
}

function escapeCell(value: string | number | undefined | null): string {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
