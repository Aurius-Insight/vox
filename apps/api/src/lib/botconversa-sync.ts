import { deriveStage, deriveUnit } from './botconversa-mapping.js';
import type { SystemicStageSlug } from './lead-stage-cache.js';

// Logica pura de sincronizacao de um contato do BotConversa para um Lead.
// Compartilhada pelo import (lote) e pelo poll (incremental) — manter a regra
// num so lugar garante que os dois caminhos se comportem de forma identica.

/** Tag de um subscriber como a API entrega: id numerico, nome cru ou objeto. */
type RawTag = number | string | { id?: number; name?: string };

/** Subset do subscriber do BotConversa usado pela sincronizacao de leads. */
export type BotConversaSubscriber = {
  id: number | string;
  full_name?: string | null;
  phone?: string | null;
  tags?: RawTag[];
  campaigns?: Array<{ name?: string | null }>;
};

/** Estado atual do Lead no banco — apenas os campos que a sincronizacao consulta. */
export type ExistingLead = {
  id: string;
  name: string;
  unitInterest: string;
  campaign: string | null;
  /** slug atual do stage do lead (lido via JOIN com LeadStage.slug). */
  stageSlug: string;
  botconversaContactId: string | null;
};

export type LeadCreateData = {
  name: string;
  whatsapp: string;
  unitInterest: string;
  campaign: string | undefined;
  source: string;
  stage: SystemicStageSlug;
  botconversaContactId: string;
};

export type LeadUpdateData = {
  name: string;
  unitInterest: string;
  campaign: string | undefined;
  // Pode ser SystemicStageSlug (lead em `novo_lead` → vira slug derivado das
  // tags) ou slug custom (se coordenacao moveu o lead pra etapa criada).
  stage: string;
  botconversaContactId: string;
};

export type LeadSyncResult =
  | { action: 'skip'; reason: string }
  | { action: 'create'; data: LeadCreateData }
  | { action: 'update'; leadId: string; data: LeadUpdateData };

/** Telefone reduzido a digitos. Strings nulas/indefinidas viram ''. */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Minimo de digitos para tratar um contato como lead (DDD + numero). */
export const MIN_PHONE_DIGITS = 8;

const UNIT_NOT_SET = 'Nao informado';

/** Normaliza as tags do subscriber (id, string ou objeto) para nomes string. */
export function tagNamesOf(
  subscriber: BotConversaSubscriber,
  tagsById: ReadonlyMap<number, string>,
): string[] {
  return (subscriber.tags ?? [])
    .map((tag) => {
      if (typeof tag === 'number') return tagsById.get(tag) ?? '';
      if (typeof tag === 'string') return tag;
      if (tag && typeof tag === 'object') {
        return tag.name ?? (tag.id ? tagsById.get(tag.id) ?? '' : '');
      }
      return '';
    })
    .filter((name): name is string => Boolean(name));
}

/**
 * Decide como gravar um Lead a partir de um subscriber do BotConversa.
 * Funcao pura — toda a regra de merge vive aqui:
 *  - "Kanban manda": a etapa so e atualizada enquanto o lead esta em
 *    `novo_lead`; leads ja trabalhados nunca regridem.
 *  - Unidade, campanha e contactId sao complementados, nunca sobrescritos
 *    quando ja preenchidos. O nome sempre acompanha o BotConversa.
 */
export function resolveLeadFromSubscriber(input: {
  subscriber: BotConversaSubscriber;
  tagNames: readonly string[];
  existingLead: ExistingLead | null;
  source: string;
}): LeadSyncResult {
  const { subscriber, tagNames, existingLead, source } = input;

  const whatsapp = normalizePhone(subscriber.phone);
  if (whatsapp.length < MIN_PHONE_DIGITS) {
    return { action: 'skip', reason: 'telefone ausente ou invalido' };
  }

  const campaignName = subscriber.campaigns?.[0]?.name ?? null;
  const stage = deriveStage(tagNames);
  const unit = deriveUnit(tagNames, campaignName);
  const contactId = String(subscriber.id);

  if (existingLead) {
    return {
      action: 'update',
      leadId: existingLead.id,
      data: {
        name: subscriber.full_name ?? existingLead.name,
        unitInterest:
          existingLead.unitInterest === UNIT_NOT_SET && unit ? unit : existingLead.unitInterest,
        campaign: existingLead.campaign ?? campaignName ?? undefined,
        // "Kanban manda": stage so atualiza enquanto lead ainda esta em
        // `novo_lead`. Para leads em qualquer outra etapa (sistemica ou
        // custom), preserva o que coordenacao definiu.
        stage: existingLead.stageSlug === 'novo_lead' ? stage : existingLead.stageSlug,
        botconversaContactId: existingLead.botconversaContactId ?? contactId,
      },
    };
  }

  return {
    action: 'create',
    data: {
      name: subscriber.full_name ?? 'Sem nome',
      whatsapp,
      unitInterest: unit ?? UNIT_NOT_SET,
      campaign: campaignName ?? undefined,
      source,
      stage,
      botconversaContactId: contactId,
    },
  };
}
