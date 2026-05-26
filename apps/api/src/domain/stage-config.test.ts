import { describe, expect, it } from 'vitest';
import {
  resolveStageArchive,
  resolveStageCreate,
  resolveStageDelete,
  validateStageReorder,
} from './stage-config.js';

describe('resolveStageCreate', () => {
  it('aceita slug e label validos', () => {
    expect(
      resolveStageCreate({
        label: 'Em negociacao',
        slug: 'em_negociacao',
        existingSlugs: ['novo_lead', 'matriculado'],
        existingOrders: [1, 2],
        kind: 'active',
      }),
    ).toEqual({ ok: true });
  });

  it('rejeita slug com caracteres invalidos', () => {
    expect(
      resolveStageCreate({
        label: 'X',
        slug: 'em-negociacao',
        existingSlugs: [],
        existingOrders: [],
        kind: 'active',
      }),
    ).toEqual({ ok: false, reason: 'invalid_slug' });
  });

  it('rejeita slug ja existente', () => {
    expect(
      resolveStageCreate({
        label: 'X',
        slug: 'matriculado',
        existingSlugs: ['matriculado'],
        existingOrders: [1],
        kind: 'active',
      }),
    ).toEqual({ ok: false, reason: 'slug_taken' });
  });

  it('rejeita label vazio', () => {
    expect(
      resolveStageCreate({
        label: '   ',
        slug: 'algo',
        existingSlugs: [],
        existingOrders: [],
        kind: 'active',
      }),
    ).toEqual({ ok: false, reason: 'invalid_label' });
  });
});

describe('resolveStageArchive', () => {
  const target = (overrides: Partial<{ slug: string; systemic: boolean; archived: boolean }> = {}) => ({
    slug: 'pre_agendamento',
    systemic: false,
    archived: false,
    ...overrides,
  });

  it('arquiva etapa nao-sistemica sem leads sem precisar de destino', () => {
    expect(
      resolveStageArchive({
        target: target(),
        leadsInStage: 0,
        destination: null,
        sameStage: false,
      }),
    ).toEqual({ ok: true, moveLeads: false });
  });

  it('bloqueia archive de etapa sistemica', () => {
    expect(
      resolveStageArchive({
        target: target({ systemic: true }),
        leadsInStage: 0,
        destination: null,
        sameStage: false,
      }),
    ).toEqual({ ok: false, reason: 'systemic_stage' });
  });

  it('bloqueia archive de etapa ja arquivada', () => {
    expect(
      resolveStageArchive({
        target: target({ archived: true }),
        leadsInStage: 0,
        destination: null,
        sameStage: false,
      }),
    ).toEqual({ ok: false, reason: 'already_archived' });
  });

  it('exige destino quando ha leads', () => {
    expect(
      resolveStageArchive({
        target: target(),
        leadsInStage: 12,
        destination: null,
        sameStage: false,
      }),
    ).toEqual({ ok: false, reason: 'destination_required' });
  });

  it('rejeita destino arquivado', () => {
    expect(
      resolveStageArchive({
        target: target(),
        leadsInStage: 12,
        destination: { id: 'st_perdido', archived: true },
        sameStage: false,
      }),
    ).toEqual({ ok: false, reason: 'destination_archived' });
  });

  it('rejeita destino igual a origem', () => {
    expect(
      resolveStageArchive({
        target: target(),
        leadsInStage: 12,
        destination: { id: 'st_pre_agendamento', archived: false },
        sameStage: true,
      }),
    ).toEqual({ ok: false, reason: 'destination_same_as_source' });
  });

  it('move leads quando destino e valido', () => {
    expect(
      resolveStageArchive({
        target: target(),
        leadsInStage: 12,
        destination: { id: 'st_em_atendimento', archived: false },
        sameStage: false,
      }),
    ).toEqual({ ok: true, moveLeads: true, destinationId: 'st_em_atendimento' });
  });
});

describe('resolveStageDelete', () => {
  const target = (overrides: Partial<{ slug: string; systemic: boolean }> = {}) => ({
    slug: 'pre_agendamento',
    systemic: false,
    ...overrides,
  });

  it('exclui sem leads e sem destino', () => {
    expect(
      resolveStageDelete({
        target: target(),
        leadsInStage: 0,
        destination: null,
        sameStage: false,
      }),
    ).toEqual({ ok: true, moveLeads: false });
  });

  it('bloqueia delete de etapa sistemica', () => {
    expect(
      resolveStageDelete({
        target: target({ systemic: true }),
        leadsInStage: 0,
        destination: null,
        sameStage: false,
      }),
    ).toEqual({ ok: false, reason: 'systemic_stage' });
  });

  it('exige destino quando ha leads', () => {
    expect(
      resolveStageDelete({
        target: target(),
        leadsInStage: 5,
        destination: null,
        sameStage: false,
      }),
    ).toEqual({ ok: false, reason: 'destination_required' });
  });

  it('move leads pra destino valido', () => {
    expect(
      resolveStageDelete({
        target: target(),
        leadsInStage: 5,
        destination: { id: 'st_em_atendimento', archived: false },
        sameStage: false,
      }),
    ).toEqual({ ok: true, moveLeads: true, destinationId: 'st_em_atendimento' });
  });
});

describe('validateStageReorder', () => {
  it('aceita lista completa com ordens unicas', () => {
    expect(
      validateStageReorder({
        currentIds: ['a', 'b', 'c'],
        newOrder: [
          { id: 'c', order: 1 },
          { id: 'a', order: 2 },
          { id: 'b', order: 3 },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it('rejeita lista incompleta', () => {
    expect(
      validateStageReorder({
        currentIds: ['a', 'b', 'c'],
        newOrder: [{ id: 'a', order: 1 }],
      }),
    ).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('rejeita ordens duplicadas', () => {
    expect(
      validateStageReorder({
        currentIds: ['a', 'b'],
        newOrder: [
          { id: 'a', order: 1 },
          { id: 'b', order: 1 },
        ],
      }),
    ).toEqual({ ok: false, reason: 'duplicate_order' });
  });

  it('rejeita id desconhecido', () => {
    expect(
      validateStageReorder({
        currentIds: ['a'],
        newOrder: [{ id: 'z', order: 1 }],
      }),
    ).toEqual({ ok: false, reason: 'unknown_stage' });
  });
});
