import type { LeadStage } from '@prisma/client';

/**
 * Mapeamento das tags do BotConversa para nosso `LeadStage` + `unitInterest`.
 * Isolado do banco e da rede para ser puro/testavel.
 *
 * A regra de prioridade evita inconsistencia quando um lead tem varias tags:
 * matriculado > perdido > experimental_agendada > em_atendimento > novo_lead.
 */

// Unidades reais da Vox RJ inferidas das tags/campanhas do painel. Cada item
// e um par (rotulo canonico, regex para casar variantes na string crua).
const KNOWN_UNITS: ReadonlyArray<{ label: string; matcher: RegExp }> = [
  { label: 'Catete', matcher: /catete/i },
  { label: 'Copacabana', matcher: /copacabana|copa/i },
  { label: 'Icaraí', matcher: /icara[ií]/i },
  // Lookarounds (em vez de \b) porque `_` e considerado palavra em regex e
  // tags como `Ato_Nit` quebrariam o boundary.
  { label: 'Niterói', matcher: /(?<![a-z])nit(?![a-z])|niter[oó]i/i },
  { label: 'Santa Rosa', matcher: /santa[\s_]?rosa/i },
  { label: 'Tijuca', matcher: /tijuca/i },
];

// Tag -> stage com prioridade. A primeira regra que casa vence.
const TAG_STAGE_RULES: ReadonlyArray<{ pattern: RegExp; stage: LeadStage }> = [
  // Terminais — mais especificos primeiro.
  { pattern: /^CLIENTES$/i, stage: 'matriculado' },
  { pattern: /sem\s?interesse|n[aã]o\s?responde|SEMGRANA|INATIVIDADE|inativAssistGPT|ContaInat/i, stage: 'perdido' },
  { pattern: /VEIO\s+E\s+N[ÃA]O\s+FECHOU|MARCOU\s+E\s+DESMARCOU|NO\s+SHOW|confirmado\s+mas\s+faltou|confirmou\s+mas\s+faltou/i, stage: 'perdido' },
  // Confirmou comparecimento (futuro).
  { pattern: /CONFIRMADO|CONFIRMADOS|CONFIRMOU\s+MESMO/i, stage: 'experimental_agendada' },
  // Em atendimento ativo.
  { pattern: /^SHOW$/i, stage: 'em_atendimento' },         // ja veio mas nao fechou
  { pattern: /Em_Atendimento|Precisa_Humano|Lead_|LISTA\s+DE\s+ESPERA|Lista\s+de\s+espera/i, stage: 'em_atendimento' },
  // Default catch-all.
  { pattern: /^NOVO$/i, stage: 'novo_lead' },
];

/**
 * Decide o stage do lead a partir das tags do BotConversa.
 * Sem tag conhecida -> `novo_lead` (assume primeiro contato).
 */
export function deriveStage(tagNames: readonly string[]): LeadStage {
  for (const rule of TAG_STAGE_RULES) {
    if (tagNames.some((t) => rule.pattern.test(t))) return rule.stage;
  }
  return 'novo_lead';
}

/**
 * Tenta extrair a unidade de interesse a partir das tags e/ou nome da campanha.
 * Concatena tudo, normaliza e procura por uma das unidades conhecidas.
 * Retorna `null` se nada bater (fica como "Nao informado" no Lead).
 */
export function deriveUnit(tagNames: readonly string[], campaignName?: string | null): string | null {
  const haystack = [...tagNames, campaignName ?? ''].join(' ');
  for (const unit of KNOWN_UNITS) {
    if (unit.matcher.test(haystack)) return unit.label;
  }
  return null;
}

/** Lista canonica das unidades conhecidas — exposta para seed e configuracao. */
export const VOX_UNITS: readonly string[] = KNOWN_UNITS.map((u) => u.label);
