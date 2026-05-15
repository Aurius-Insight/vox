import { describe, expect, it } from 'vitest';
import { deriveStage, deriveUnit, VOX_UNITS } from './botconversa-mapping.js';

describe('deriveStage', () => {
  it('CLIENTES vence qualquer outra tag (matriculado)', () => {
    expect(deriveStage(['NOVO', 'CLIENTES', 'Em_Atendimento'])).toBe('matriculado');
  });

  it('mapeia tags de perda para perdido', () => {
    expect(deriveStage(['NO SHOW'])).toBe('perdido');
    expect(deriveStage(['VEIO E NÃO FECHOU'])).toBe('perdido');
    expect(deriveStage(['Sem interesse'])).toBe('perdido');
    expect(deriveStage(['MARCOU E DESMARCOU'])).toBe('perdido');
    expect(deriveStage(['SEMGRANA'])).toBe('perdido');
    expect(deriveStage(['Confirmado mas faltou Rio'])).toBe('perdido');
  });

  it('CONFIRMADO leva a experimental_agendada', () => {
    expect(deriveStage(['CONFIRMADO'])).toBe('experimental_agendada');
    expect(deriveStage(['CONFIRMADOS CATETE'])).toBe('experimental_agendada');
    expect(deriveStage(['CONFIRMOU MESMO'])).toBe('experimental_agendada');
  });

  it('SHOW (compareceu mas nao fechou) e tags ativas viram em_atendimento', () => {
    expect(deriveStage(['SHOW'])).toBe('em_atendimento');
    expect(deriveStage(['Em_Atendimento'])).toBe('em_atendimento');
    expect(deriveStage(['Precisa_Humano'])).toBe('em_atendimento');
    expect(deriveStage(['Lead_Catete'])).toBe('em_atendimento');
    expect(deriveStage(['LISTA DE ESPERA CATETE'])).toBe('em_atendimento');
  });

  it('NOVO ou nenhuma tag conhecida cai em novo_lead', () => {
    expect(deriveStage(['NOVO'])).toBe('novo_lead');
    expect(deriveStage([])).toBe('novo_lead');
    expect(deriveStage(['TagDesconhecida'])).toBe('novo_lead');
  });

  it('prioridade: perdido vence ativo', () => {
    expect(deriveStage(['Em_Atendimento', 'NO SHOW'])).toBe('perdido');
  });
});

describe('deriveUnit', () => {
  it('reconhece unidade a partir da tag', () => {
    expect(deriveUnit(['CONFIRMADOS CATETE'])).toBe('Catete');
    expect(deriveUnit(['LISTA DE ESPERA TIJUCA'])).toBe('Tijuca');
    expect(deriveUnit(['Ato_Nit'])).toBe('Niterói');
    expect(deriveUnit(['Icaraí_NIT_Quarta'])).toBe('Icaraí');
    expect(deriveUnit(['Lista de Espera Santa Rosa'])).toBe('Santa Rosa');
    expect(deriveUnit(['Copacabana'])).toBe('Copacabana');
  });

  it('reconhece unidade a partir do nome da campanha', () => {
    expect(deriveUnit([], 'C24 CATETE')).toBe('Catete');
    expect(deriveUnit([], 'C28 ICARAÍ')).toBe('Icaraí');
  });

  it('case-insensitive e ignora acentos onde possivel', () => {
    expect(deriveUnit(['catete'])).toBe('Catete');
    expect(deriveUnit(['CATETE'])).toBe('Catete');
    expect(deriveUnit(['icarai'])).toBe('Icaraí');
  });

  it('devolve null quando nao reconhece', () => {
    expect(deriveUnit(['NOVO'])).toBeNull();
    expect(deriveUnit([], 'Sem unidade')).toBeNull();
  });
});

describe('VOX_UNITS', () => {
  it('expoe a lista canonica das 6 unidades', () => {
    expect(VOX_UNITS).toEqual(['Catete', 'Copacabana', 'Icaraí', 'Niterói', 'Santa Rosa', 'Tijuca']);
  });
});
