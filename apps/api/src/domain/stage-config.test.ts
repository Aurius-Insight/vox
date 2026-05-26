import { describe, expect, it } from 'vitest';
import {
  resolveStageArchive,
  validateStageReorder,
  type StageConfigInput,
} from './stage-config.js';

const base = (overrides: Partial<StageConfigInput> = {}): StageConfigInput => ({
  stage: 'pre_agendamento',
  label: 'Pre-agendamento',
  order: 3,
  visible: true,
  systemic: false,
  ...overrides,
});

describe('resolveStageArchive', () => {
  it('permite arquivar etapa nao-sistemica sem leads', () => {
    const result = resolveStageArchive({
      target: base(),
      leadsInStage: 0,
      destination: null,
      destinationConfig: null,
    });
    expect(result).toEqual({ ok: true, moveLeads: false });
  });

  it('bloqueia archive de etapa sistemica', () => {
    const result = resolveStageArchive({
      target: base({ stage: 'matriculado', systemic: true }),
      leadsInStage: 0,
      destination: null,
      destinationConfig: null,
    });
    expect(result).toEqual({ ok: false, reason: 'systemic_stage' });
  });

  it('exige destino quando ha leads na etapa', () => {
    const result = resolveStageArchive({
      target: base(),
      leadsInStage: 12,
      destination: null,
      destinationConfig: null,
    });
    expect(result).toEqual({ ok: false, reason: 'destination_required' });
  });

  it('rejeita destino igual a origem', () => {
    const result = resolveStageArchive({
      target: base({ stage: 'pre_agendamento' }),
      leadsInStage: 12,
      destination: 'pre_agendamento',
      destinationConfig: base({ stage: 'pre_agendamento' }),
    });
    expect(result).toEqual({ ok: false, reason: 'destination_same_as_source' });
  });

  it('rejeita destino que nao existe', () => {
    const result = resolveStageArchive({
      target: base(),
      leadsInStage: 12,
      destination: 'matriculado',
      destinationConfig: null,
    });
    expect(result).toEqual({ ok: false, reason: 'destination_not_found' });
  });

  it('rejeita destino arquivado', () => {
    const result = resolveStageArchive({
      target: base(),
      leadsInStage: 12,
      destination: 'perdido',
      destinationConfig: base({ stage: 'perdido', visible: false }),
    });
    expect(result).toEqual({ ok: false, reason: 'destination_archived' });
  });

  it('aceita move com destino valido', () => {
    const result = resolveStageArchive({
      target: base(),
      leadsInStage: 12,
      destination: 'em_atendimento',
      destinationConfig: base({ stage: 'em_atendimento' }),
    });
    expect(result).toEqual({ ok: true, moveLeads: true, destination: 'em_atendimento' });
  });
});

describe('validateStageReorder', () => {
  it('aceita reorder com todas as etapas presentes e ordens unicas', () => {
    const result = validateStageReorder({
      current: [
        base({ stage: 'novo_lead', order: 1 }),
        base({ stage: 'em_atendimento', order: 2 }),
        base({ stage: 'pre_agendamento', order: 3 }),
      ],
      newOrder: [
        { stage: 'pre_agendamento', order: 1 },
        { stage: 'novo_lead', order: 2 },
        { stage: 'em_atendimento', order: 3 },
      ],
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejeita lista incompleta (falta etapa)', () => {
    const result = validateStageReorder({
      current: [
        base({ stage: 'novo_lead', order: 1 }),
        base({ stage: 'em_atendimento', order: 2 }),
      ],
      newOrder: [{ stage: 'novo_lead', order: 1 }],
    });
    expect(result).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('rejeita ordem duplicada', () => {
    const result = validateStageReorder({
      current: [
        base({ stage: 'novo_lead', order: 1 }),
        base({ stage: 'em_atendimento', order: 2 }),
      ],
      newOrder: [
        { stage: 'novo_lead', order: 1 },
        { stage: 'em_atendimento', order: 1 },
      ],
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate_order' });
  });

  it('rejeita etapa desconhecida', () => {
    const result = validateStageReorder({
      current: [base({ stage: 'novo_lead', order: 1 })],
      newOrder: [{ stage: 'pre_agendamento', order: 1 }],
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_stage' });
  });
});
