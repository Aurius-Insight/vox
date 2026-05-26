export type LeadStageSlug =
  | 'novo_lead'
  | 'em_atendimento'
  | 'pre_agendamento'
  | 'experimental_agendada'
  | 'matriculado'
  | 'perdido';

export type StageConfigInput = {
  stage: LeadStageSlug;
  label: string;
  color?: string | null;
  order: number;
  visible: boolean;
  systemic: boolean;
};

export type StageArchiveResult =
  | { ok: true; moveLeads: false }
  | { ok: true; moveLeads: true; destination: LeadStageSlug }
  | {
      ok: false;
      reason:
        | 'systemic_stage'
        | 'destination_required'
        | 'destination_not_found'
        | 'destination_archived'
        | 'destination_same_as_source';
    };

/**
 * Regra de archive de etapa do pipeline.
 * - Sistemicas (newo_lead, matriculado, experimental_agendada por padrao)
 *   nao podem ser arquivadas — codigo escreve nelas.
 * - Se ha leads na etapa, exige escolher destino valido (existente,
 *   nao-arquivado, diferente da origem).
 * - Sem leads, archive direto.
 */
export function resolveStageArchive(input: {
  target: StageConfigInput;
  leadsInStage: number;
  destination: LeadStageSlug | null;
  destinationConfig: StageConfigInput | null;
}): StageArchiveResult {
  if (input.target.systemic) {
    return { ok: false, reason: 'systemic_stage' };
  }

  if (input.leadsInStage === 0) {
    return { ok: true, moveLeads: false };
  }

  if (input.destination === null) {
    return { ok: false, reason: 'destination_required' };
  }

  if (input.destination === input.target.stage) {
    return { ok: false, reason: 'destination_same_as_source' };
  }

  if (!input.destinationConfig) {
    return { ok: false, reason: 'destination_not_found' };
  }

  if (!input.destinationConfig.visible) {
    return { ok: false, reason: 'destination_archived' };
  }

  return { ok: true, moveLeads: true, destination: input.destination };
}

export type StageReorderResult =
  | { ok: true }
  | { ok: false; reason: 'incomplete' | 'duplicate_order' | 'unknown_stage' };

/**
 * Valida reorder em bulk — front manda lista completa de (stage, order).
 * Lista precisa cobrir todas as etapas existentes, ordens unicas.
 */
export function validateStageReorder(input: {
  current: StageConfigInput[];
  newOrder: Array<{ stage: LeadStageSlug; order: number }>;
}): StageReorderResult {
  if (input.newOrder.length !== input.current.length) {
    return { ok: false, reason: 'incomplete' };
  }

  const knownStages = new Set(input.current.map((s) => s.stage));
  const seenStages = new Set<string>();
  const seenOrders = new Set<number>();

  for (const item of input.newOrder) {
    if (!knownStages.has(item.stage)) {
      return { ok: false, reason: 'unknown_stage' };
    }
    if (seenStages.has(item.stage)) {
      return { ok: false, reason: 'unknown_stage' };
    }
    if (seenOrders.has(item.order)) {
      return { ok: false, reason: 'duplicate_order' };
    }
    seenStages.add(item.stage);
    seenOrders.add(item.order);
  }

  return { ok: true };
}
