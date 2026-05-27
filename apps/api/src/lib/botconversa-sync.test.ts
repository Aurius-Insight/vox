import { describe, expect, it } from 'vitest';
import { MIN_PHONE_DIGITS, normalizePhone, resolveLeadFromSubscriber, tagNamesOf } from './botconversa-sync.js';
import type { BotConversaSubscriber, ExistingLead } from './botconversa-sync.js';

function subscriber(overrides: Partial<BotConversaSubscriber> = {}): BotConversaSubscriber {
  return {
    id: 123,
    full_name: 'Maria Silva',
    phone: '+55 (21) 99999-1234',
    tags: [],
    campaigns: [],
    ...overrides,
  };
}

function existingLead(overrides: Partial<ExistingLead> = {}): ExistingLead {
  return {
    id: 'lead_1',
    name: 'Maria Silva',
    unitInterest: 'Nao informado',
    campaign: null,
    stageSlug: 'novo_lead',
    botconversaContactId: null,
    hasStudent: false,
    ...overrides,
  };
}

describe('normalizePhone', () => {
  it('mantem apenas digitos', () => {
    expect(normalizePhone('+55 (21) 99999-1234')).toBe('5521999991234');
  });

  it('trata nulo/indefinido como string vazia', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
});

describe('tagNamesOf', () => {
  const catalog = new Map([
    [1, 'NOVO'],
    [2, 'CONFIRMADO'],
  ]);

  it('resolve tag por id numerico via catalogo', () => {
    expect(tagNamesOf(subscriber({ tags: [1, 2] }), catalog)).toEqual(['NOVO', 'CONFIRMADO']);
  });

  it('aceita tag ja em formato string', () => {
    expect(tagNamesOf(subscriber({ tags: ['Lead_Catete'] }), catalog)).toEqual(['Lead_Catete']);
  });

  it('aceita tag em objeto (por name ou por id)', () => {
    expect(tagNamesOf(subscriber({ tags: [{ name: 'SHOW' }, { id: 1 }] }), catalog)).toEqual([
      'SHOW',
      'NOVO',
    ]);
  });

  it('descarta tags vazias ou nao resolvidas', () => {
    expect(tagNamesOf(subscriber({ tags: [999, ''] }), catalog)).toEqual([]);
  });
});

describe('resolveLeadFromSubscriber', () => {
  it('pula contato sem telefone valido', () => {
    const result = resolveLeadFromSubscriber({
      subscriber: subscriber({ phone: '123' }),
      tagNames: [],
      existingLead: null,
      source: 'BotConversa',
    });
    expect(result.action).toBe('skip');
  });

  it('exige pelo menos o minimo de digitos', () => {
    expect('1'.repeat(MIN_PHONE_DIGITS - 1).length).toBeLessThan(MIN_PHONE_DIGITS);
  });

  describe('lead novo (create)', () => {
    it('deriva etapa e unidade das tags e aplica o source', () => {
      const result = resolveLeadFromSubscriber({
        subscriber: subscriber({ tags: ['CONFIRMADOS CATETE'] }),
        tagNames: ['CONFIRMADOS CATETE'],
        existingLead: null,
        source: 'BotConversa (import)',
      });
      expect(result).toEqual({
        action: 'create',
        data: {
          name: 'Maria Silva',
          whatsapp: '5521999991234',
          unitInterest: 'Catete',
          campaign: undefined,
          source: 'BotConversa (import)',
          stage: 'experimental_agendada',
          botconversaContactId: '123',
        },
      });
    });

    it('usa "Sem nome" sem full_name e "Nao informado" sem unidade', () => {
      const result = resolveLeadFromSubscriber({
        subscriber: subscriber({ full_name: null, tags: ['NOVO'] }),
        tagNames: ['NOVO'],
        existingLead: null,
        source: 'BotConversa',
      });
      if (result.action !== 'create') throw new Error('esperava create');
      expect(result.data.name).toBe('Sem nome');
      expect(result.data.unitInterest).toBe('Nao informado');
      expect(result.data.stage).toBe('novo_lead');
    });

    it('preenche a campanha a partir do subscriber', () => {
      const result = resolveLeadFromSubscriber({
        subscriber: subscriber({ campaigns: [{ name: 'C24 CATETE' }] }),
        tagNames: [],
        existingLead: null,
        source: 'BotConversa',
      });
      if (result.action !== 'create') throw new Error('esperava create');
      expect(result.data.campaign).toBe('C24 CATETE');
    });
  });

  describe('lead existente (update)', () => {
    it('"Kanban manda": nao regride a etapa de quem ja foi trabalhado', () => {
      const result = resolveLeadFromSubscriber({
        subscriber: subscriber({ tags: ['NOVO'] }),
        tagNames: ['NOVO'],
        existingLead: existingLead({ stageSlug: 'em_atendimento' }),
        source: 'BotConversa',
      });
      if (result.action !== 'update') throw new Error('esperava update');
      expect(result.data.stage).toBe('em_atendimento');
    });

    it('avanca a etapa enquanto o lead ainda esta em novo_lead', () => {
      const result = resolveLeadFromSubscriber({
        subscriber: subscriber({ tags: ['CONFIRMADO'] }),
        tagNames: ['CONFIRMADO'],
        existingLead: existingLead({ stageSlug: 'novo_lead' }),
        source: 'BotConversa',
      });
      if (result.action !== 'update') throw new Error('esperava update');
      expect(result.data.stage).toBe('experimental_agendada');
    });

    it('"Student manda": pula o lead quando ja tem aluno vinculado', () => {
      const result = resolveLeadFromSubscriber({
        subscriber: subscriber({ tags: ['CONFIRMADO'] }),
        tagNames: ['CONFIRMADO'],
        existingLead: existingLead({ stageSlug: 'novo_lead', hasStudent: true }),
        source: 'BotConversa',
      });
      expect(result.action).toBe('skip');
      if (result.action !== 'skip') throw new Error('esperava skip');
      expect(result.reason).toBe('locked_by_student');
    });

    it('preenche a unidade apenas quando estava "Nao informado"', () => {
      const semUnidade = resolveLeadFromSubscriber({
        subscriber: subscriber({ tags: ['Lead_Catete'] }),
        tagNames: ['Lead_Catete'],
        existingLead: existingLead({ unitInterest: 'Nao informado' }),
        source: 'BotConversa',
      });
      if (semUnidade.action !== 'update') throw new Error('esperava update');
      expect(semUnidade.data.unitInterest).toBe('Catete');

      const comUnidade = resolveLeadFromSubscriber({
        subscriber: subscriber({ tags: ['Lead_Catete'] }),
        tagNames: ['Lead_Catete'],
        existingLead: existingLead({ unitInterest: 'Tijuca' }),
        source: 'BotConversa',
      });
      if (comUnidade.action !== 'update') throw new Error('esperava update');
      expect(comUnidade.data.unitInterest).toBe('Tijuca');
    });

    it('mantem a campanha existente e preenche quando vazia', () => {
      const mantem = resolveLeadFromSubscriber({
        subscriber: subscriber({ campaigns: [{ name: 'Nova' }] }),
        tagNames: [],
        existingLead: existingLead({ campaign: 'Campanha Antiga' }),
        source: 'BotConversa',
      });
      if (mantem.action !== 'update') throw new Error('esperava update');
      expect(mantem.data.campaign).toBe('Campanha Antiga');

      const preenche = resolveLeadFromSubscriber({
        subscriber: subscriber({ campaigns: [{ name: 'Nova' }] }),
        tagNames: [],
        existingLead: existingLead({ campaign: null }),
        source: 'BotConversa',
      });
      if (preenche.action !== 'update') throw new Error('esperava update');
      expect(preenche.data.campaign).toBe('Nova');
    });

    it('preserva o botconversaContactId e preenche quando ausente', () => {
      const preserva = resolveLeadFromSubscriber({
        subscriber: subscriber({ id: 999 }),
        tagNames: [],
        existingLead: existingLead({ botconversaContactId: 'id_antigo' }),
        source: 'BotConversa',
      });
      if (preserva.action !== 'update') throw new Error('esperava update');
      expect(preserva.data.botconversaContactId).toBe('id_antigo');

      const preenche = resolveLeadFromSubscriber({
        subscriber: subscriber({ id: 999 }),
        tagNames: [],
        existingLead: existingLead({ botconversaContactId: null }),
        source: 'BotConversa',
      });
      if (preenche.action !== 'update') throw new Error('esperava update');
      expect(preenche.data.botconversaContactId).toBe('999');
    });

    it('atualiza o nome com o valor vindo do subscriber', () => {
      const result = resolveLeadFromSubscriber({
        subscriber: subscriber({ full_name: 'Maria Souza' }),
        tagNames: [],
        existingLead: existingLead({ name: 'Maria Silva' }),
        source: 'BotConversa',
      });
      if (result.action !== 'update') throw new Error('esperava update');
      expect(result.data.name).toBe('Maria Souza');
    });
  });
});
