import type { CellOutcome } from './types.js';

const PT_MONTHS: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

// Ano de referencia (corrente). Datas sem ano explicito sao atribuidas
// a um ano vizinho ao atual; ajuste se rodar antes de virar 2027.
const REF_YEAR = 2026;

// Parser comum: aceita strings vazias retorna null (skip), aceita texto
// composto ("19/01/26 EXP", "12/05 / 21980813960", "EXP 15/01") tentando
// extrair a primeira data e jogando o resto pra revisao por pacote especifico.

// --- TIJUCA: DD/MMM. pt-br ou DD/MM ou DD.MM.YYYY ---
export function parseCellTijuca(text: string): CellOutcome | null {
  let cleaned = text.trim();
  if (cleaned === '') return null;
  // Strip prefix/sufixo de tag (EXP/EXPERIMENTAL) na celula — Tijuca tem
  // "EXP 15/01" e similares onde a tag mora junto com a data.
  cleaned = cleaned
    .replace(/^\s*(experimental|exp)\s+/i, '')
    .replace(/\s+(experimental|exp)\s*$/i, '')
    .trim();
  if (cleaned === '/' ) return null;

  // Padrao "11/dez." -> 2025/2026 ano-de-temporada
  const monthMatch = cleaned.match(/^(\d{1,2})\/([a-zç]{3})\.?$/i);
  if (monthMatch) {
    const day = Number(monthMatch[1]);
    const month = PT_MONTHS[monthMatch[2].toLowerCase()];
    if (!month) {
      return { kind: 'invalid', reason: `mes desconhecido: ${monthMatch[2]}`, sourceText: text };
    }
    // mes >= 10 = ano anterior (temporada que rolou em out/nov/dez do ano passado)
    const year = month >= 10 ? REF_YEAR - 1 : REF_YEAR;
    return buildIso(year, month, day, text);
  }

  // Padrao "05.02.2025"
  const dottedFull = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dottedFull) {
    return buildIso(Number(dottedFull[3]), Number(dottedFull[2]), Number(dottedFull[1]), text);
  }

  // Padrao "12/12/24" (DD/MM/YY brasileiro)
  const slashFull = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashFull) {
    const yy = Number(slashFull[3]);
    const year = yy < 100 ? 2000 + yy : yy;
    return buildIso(year, Number(slashFull[2]), Number(slashFull[1]), text);
  }

  // Padrao "05/02" (DD/MM ano corrente)
  const slashShort = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashShort) {
    return buildIso(REF_YEAR, Number(slashShort[2]), Number(slashShort[1]), text);
  }

  return { kind: 'invalid', reason: 'nao reconheci formato de data Tijuca', sourceText: text };
}

// --- NITEROI: DD/MM (BR), opcional YY. Algumas celulas tem ruido (EXP,
// telefone, etc.). Tentamos extrair a 1a data; o ruido vai pra invalid.
export function parseCellNiteroi(text: string): CellOutcome | null {
  let cleaned = text.trim();
  if (cleaned === '') return null;

  // Strip sufixo de tag colado/separado ("02/03EXP", "19/01/26 EXP").
  cleaned = cleaned.replace(/(experimental|exp)\s*$/i, '').trim();

  // Contador FEV / numero solitario (1-31): NAO e data — coluna FEV.
  if (/^\d{1,2}$/.test(cleaned)) {
    return { kind: 'invalid', reason: 'numero solitario (provavel contador)', sourceText: text };
  }

  // DD/MM/YY ou DD/MM/YYYY
  const full = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (full) {
    const yy = Number(full[3]);
    const year = yy < 100 ? 2000 + yy : yy;
    return buildIso(year, Number(full[2]), Number(full[1]), text);
  }

  // DD/MM (sem ano)
  const short = cleaned.match(/^(\d{1,2})\/(\d{1,2})\b/);
  if (short) {
    const day = Number(short[1]);
    const month = Number(short[2]);
    return buildIso(REF_YEAR, month, day, text);
  }

  return { kind: 'invalid', reason: 'nao reconheci formato de data Niteroi', sourceText: text };
}

// --- CATETE: pesadelo. Misto MM/DD/YY (US) e DD/MM/YY (BR) na mesma
// planilha, e ate na mesma linha. Heuristica:
//   - se primeiro grupo > 12 -> obrigatoriamente DD/MM/YY
//   - se segundo grupo > 12  -> obrigatoriamente MM/DD/YY
//   - ambos <= 12            -> AMBIGUO. Marcamos pra revisao.
export function parseCellCatete(text: string): CellOutcome | null {
  let cleaned = text.trim();
  if (cleaned === '') return null;

  // Catete varia muito: "25/11/25 EXP", "21/08 exp", "29/4/2025" etc.
  // Tira o sufixo EXP/EXPERIMENTAL (e variantes "aula exp") antes do match.
  // A tag e capturada na coluna do nome; a celula vira so a data.
  cleaned = cleaned
    .replace(/\s*aula\s+(experimental|exp)\s*$/i, '')
    .replace(/\s*(experimental|exp)\s*$/i, '')
    .trim();
  if (cleaned === '/' ) return null;

  // Filtra notas livres ("DO DIA 21/01 FALTAVAM 3 AULAS").
  if (/[a-zA-Z]/.test(cleaned)) {
    return { kind: 'invalid', reason: 'texto livre', sourceText: text };
  }

  const matchFull = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  // Catete tem alguns "21/08 exp" que apos strip viram "21/08" sem ano.
  const matchShort = cleaned.match(/^(\d{1,2})\/(\d{1,2})\b/);
  const match = matchFull ?? matchShort;
  if (!match) {
    return { kind: 'invalid', reason: 'nao reconheci formato de data Catete', sourceText: text };
  }

  const a = Number(match[1]);
  const b = Number(match[2]);
  const yy = match[3] !== undefined ? Number(match[3]) : undefined;
  const year = yy === undefined ? REF_YEAR : yy < 100 ? 2000 + yy : yy;

  if (a > 12) {
    // BR garantido
    return buildIso(year, b, a, text);
  }
  if (b > 12) {
    // US garantido
    return buildIso(year, a, b, text);
  }
  // Ambiguo: ambos <= 12. Assume US (mais comum nessa planilha) e marca.
  const iso = buildIso(year, a, b, text);
  if (iso.kind === 'date') iso.ambiguous = true;
  return iso;
}

function buildIso(year: number, month: number, day: number, sourceText: string): CellOutcome {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { kind: 'invalid', reason: `data fora do intervalo: ${day}/${month}/${year}`, sourceText };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { kind: 'invalid', reason: `data nao existente: ${day}/${month}/${year}`, sourceText };
  }
  const iso = date.toISOString().slice(0, 10);
  return { kind: 'date', isoDate: iso, sourceText };
}
