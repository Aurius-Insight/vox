// Tipos comuns do ETL de absorcao das planilhas (Catete, Niteroi, Tijuca).
// O fluxo e em duas fases: dry-run (este pacote, F3) gera CSVs de revisao;
// depois F4 aplica as decisoes no banco. Nada aqui escreve no DB.

export type UnitSlug = 'catete' | 'niteroi' | 'tijuca';

export type StudentTag =
  | 'EXP'
  | 'MENSALISTA'
  | 'MIX'
  | 'ATO'
  | 'ADVOGADO'
  | 'MIGROU'
  | 'CATETE'
  | 'TIJUCA'
  | 'CIVIL';

// Uma celula da planilha vira EITHER uma data ISO valida OU um "achado"
// pra revisao (texto livre, contador, flag suspeita...).
export type CellOutcome =
  | { kind: 'date'; isoDate: string; ambiguous?: boolean; sourceText: string }
  | { kind: 'invalid'; reason: string; sourceText: string };

export type ParsedRow = {
  unit: UnitSlug;
  rowIndex: number;          // numero da linha no CSV (1-based, ignora header)
  rawName: string;           // nome literal da celula
  normalizedName: string;    // sem acentos, lowercase, sem sufixos
  tags: StudentTag[];        // EXP/MENSALISTA/...
  dates: string[];           // ISO yyyy-mm-dd, ja parseados
  ambiguousDates: Array<{    // ISO + texto original, pra revisao manual
    isoDate: string;
    sourceText: string;
    columnIndex: number;
  }>;
  invalidCells: Array<{
    columnIndex: number;     // 0-based dentro da linha (incluindo a coluna do nome)
    sourceText: string;
    reason: string;
  }>;
  fevCounter?: number;       // so Niteroi
};

export type DedupMatch =
  | { kind: 'exato'; leadId: string; leadName: string }
  | { kind: 'parcial'; leadId: string; leadName: string; similarity: number }
  | { kind: 'sem-match' };

export type EnrichedRow = ParsedRow & {
  dedup: DedupMatch;
};

export type ImportSummary = {
  unit: UnitSlug;
  totalRows: number;
  totalDates: number;
  totalAmbiguousDates: number;
  totalInvalidCells: number;
  byDedup: { exato: number; parcial: number; semMatch: number };
};
