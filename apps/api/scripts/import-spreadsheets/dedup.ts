import type { DedupMatch } from './types.js';
import { normalizeForDedup } from './name-normalizer.js';

// Cache local de leads ja normalizados pra evitar recomputar em cada linha.
export type LeadIndexItem = {
  leadId: string;
  rawName: string;
  normalized: string;
};

export function buildLeadIndex(
  leads: Array<{ id: string; name: string }>,
): LeadIndexItem[] {
  return leads.map((lead) => ({
    leadId: lead.id,
    rawName: lead.name,
    normalized: normalizeForDedup(lead.name),
  }));
}

// Para cada linha da planilha, classifica como exato, parcial (>= threshold)
// ou sem-match comparando contra todos os Leads. Levenshtein normalizado
// custa O(n*m) mas com ~432 leads x ~552 alunos = ~240k comparacoes — barato.
const PARTIAL_THRESHOLD = 0.82;

export function classifyMatch(
  spreadsheetName: string,
  leads: LeadIndexItem[],
): DedupMatch {
  const target = normalizeForDedup(spreadsheetName);
  if (target === '') return { kind: 'sem-match' };

  // 1. Match exato (apos normalizacao).
  const exact = leads.find((lead) => lead.normalized === target);
  if (exact) {
    return { kind: 'exato', leadId: exact.leadId, leadName: exact.rawName };
  }

  // 2. Match parcial via similaridade. Pega o melhor candidato acima do
  //    threshold; se nenhum bate, devolve sem-match.
  let best: { lead: LeadIndexItem; similarity: number } | null = null;
  for (const lead of leads) {
    const sim = jaroWinkler(target, lead.normalized);
    if (sim >= PARTIAL_THRESHOLD && (best == null || sim > best.similarity)) {
      best = { lead, similarity: sim };
    }
  }
  if (best) {
    return {
      kind: 'parcial',
      leadId: best.lead.leadId,
      leadName: best.lead.rawName,
      similarity: Number(best.similarity.toFixed(3)),
    };
  }

  return { kind: 'sem-match' };
}

// Jaro-Winkler em pt-br trabalha melhor com nomes do que Levenshtein puro
// porque pondera prefixo comum (sobrenomes ordenados etc.).
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const jaro = jaroSimilarity(a, b);
  if (jaro < 0.7) return jaro;
  const prefix = commonPrefixLength(a, b, 4);
  return jaro + prefix * 0.1 * (1 - jaro);
}

function jaroSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches: boolean[] = new Array(a.length).fill(false);
  const bMatches: boolean[] = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

function commonPrefixLength(a: string, b: string, max: number): number {
  const limit = Math.min(max, a.length, b.length);
  let count = 0;
  for (let i = 0; i < limit; i++) {
    if (a[i] === b[i]) count++;
    else break;
  }
  return count;
}
