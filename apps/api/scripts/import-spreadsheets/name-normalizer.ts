import type { StudentTag } from './types.js';

const TAG_PATTERNS: Array<{ tag: StudentTag; regex: RegExp }> = [
  { tag: 'EXP',        regex: /\b(experimental|exp)\b/gi },
  { tag: 'MENSALISTA', regex: /\b(mensalista|mensalist)\b/gi },
  { tag: 'MIX',        regex: /\bmix\b/gi },
  { tag: 'ATO',        regex: /\bato\b/gi },
  { tag: 'ADVOGADO',   regex: /\badvogado\b/gi },
  { tag: 'MIGROU',     regex: /\bmigrou(\s+\w+)?\b/gi },
  { tag: 'CATETE',     regex: /\bcatete\b/gi },
  { tag: 'TIJUCA',     regex: /\btijuca\b/gi },
  { tag: 'CIVIL',      regex: /\bcivil\b/gi },
];

// Extrai tags do nome bruto E devolve o nome limpo (sem parenteses, sufixos,
// asteriscos, interrogacoes etc.). Conservador: prefere deixar palavra no
// nome quando nao bate em padrao conhecido.
export function extractTagsAndCleanName(rawName: string): { name: string; tags: StudentTag[] } {
  const tags = new Set<StudentTag>();
  let working = rawName;

  for (const { tag, regex } of TAG_PATTERNS) {
    if (regex.test(working)) {
      tags.add(tag);
      working = working.replace(regex, ' ');
    }
  }

  // Remove parenteses e seu conteudo residual ("()", "( )", "( ADVOGADO)" etc.)
  working = working.replace(/\([^)]*\)/g, ' ');
  // Asteriscos, interrogacoes e simbolos comuns de anotacao da operacao.
  working = working.replace(/[*?¿!]+/g, ' ');
  // Multi-espacos -> 1, trim.
  working = working.replace(/\s+/g, ' ').trim();

  return { name: working, tags: [...tags] };
}

// Normalizacao "dura" pra dedup: lowercase, remove acentos, colapsa espacos.
// Nao remove tags porque a chamada espera-se que ja venha com nome limpo.
export function normalizeForDedup(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
