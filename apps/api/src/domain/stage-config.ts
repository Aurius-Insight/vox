import type { LeadStageKind } from '@prisma/client';

// Regras puras (sem DB, sem rede) que decidem o que e valido em cada
// operacao do CRUD de etapas. As rotas chamam essas funcoes e so persistem
// quando decision.ok === true.

export type StageCreateResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_slug' | 'slug_taken' | 'invalid_label' };

export function resolveStageCreate(input: {
  label: string;
  slug: string;
  existingSlugs: readonly string[];
  existingOrders: readonly number[];
  kind: LeadStageKind;
}): StageCreateResult {
  if (input.label.trim().length === 0) return { ok: false, reason: 'invalid_label' };
  if (!/^[a-z0-9_]+$/.test(input.slug)) return { ok: false, reason: 'invalid_slug' };
  if (input.existingSlugs.includes(input.slug)) return { ok: false, reason: 'slug_taken' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Archive (oculta etapa, move leads se necessario).

export type ArchiveTarget = {
  slug: string;
  systemic: boolean;
  archived: boolean;
};

export type ArchiveDestination = {
  id: string;
  archived: boolean;
};

export type StageArchiveResult =
  | { ok: true; moveLeads: false }
  | { ok: true; moveLeads: true; destinationId: string }
  | {
      ok: false;
      reason:
        | 'systemic_stage'
        | 'already_archived'
        | 'destination_required'
        | 'destination_not_found'
        | 'destination_archived'
        | 'destination_same_as_source';
    };

export function resolveStageArchive(input: {
  target: ArchiveTarget;
  leadsInStage: number;
  destination: ArchiveDestination | null;
  sameStage: boolean;
}): StageArchiveResult {
  if (input.target.systemic) return { ok: false, reason: 'systemic_stage' };
  if (input.target.archived) return { ok: false, reason: 'already_archived' };

  if (input.leadsInStage === 0) return { ok: true, moveLeads: false };

  if (input.destination === null) return { ok: false, reason: 'destination_required' };
  if (input.sameStage) return { ok: false, reason: 'destination_same_as_source' };
  if (input.destination.archived) return { ok: false, reason: 'destination_archived' };

  return { ok: true, moveLeads: true, destinationId: input.destination.id };
}

// ---------------------------------------------------------------------------
// Delete (remove permanente — mesma regra de destino se houver leads).

export type DeleteTarget = {
  slug: string;
  systemic: boolean;
};

export type StageDeleteResult =
  | { ok: true; moveLeads: false }
  | { ok: true; moveLeads: true; destinationId: string }
  | {
      ok: false;
      reason:
        | 'systemic_stage'
        | 'destination_required'
        | 'destination_not_found'
        | 'destination_archived'
        | 'destination_same_as_source';
    };

export function resolveStageDelete(input: {
  target: DeleteTarget;
  leadsInStage: number;
  destination: ArchiveDestination | null;
  sameStage: boolean;
}): StageDeleteResult {
  if (input.target.systemic) return { ok: false, reason: 'systemic_stage' };

  if (input.leadsInStage === 0) return { ok: true, moveLeads: false };

  if (input.destination === null) return { ok: false, reason: 'destination_required' };
  if (input.sameStage) return { ok: false, reason: 'destination_same_as_source' };
  if (input.destination.archived) return { ok: false, reason: 'destination_archived' };

  return { ok: true, moveLeads: true, destinationId: input.destination.id };
}

// ---------------------------------------------------------------------------
// Reorder (bulk de pares id/order, ordens unicas, cobre todas existentes).

export type StageReorderResult =
  | { ok: true }
  | { ok: false; reason: 'incomplete' | 'duplicate_order' | 'unknown_stage' };

export function validateStageReorder(input: {
  currentIds: readonly string[];
  newOrder: ReadonlyArray<{ id: string; order: number }>;
}): StageReorderResult {
  if (input.newOrder.length !== input.currentIds.length) {
    return { ok: false, reason: 'incomplete' };
  }
  const known = new Set(input.currentIds);
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();

  for (const item of input.newOrder) {
    if (!known.has(item.id)) return { ok: false, reason: 'unknown_stage' };
    if (seenIds.has(item.id)) return { ok: false, reason: 'unknown_stage' };
    if (seenOrders.has(item.order)) return { ok: false, reason: 'duplicate_order' };
    seenIds.add(item.id);
    seenOrders.add(item.order);
  }
  return { ok: true };
}
