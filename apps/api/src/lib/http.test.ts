import { describe, expect, it } from 'vitest';
import { maskCpf, maskPhone, parsePagination } from './http.js';

describe('maskPhone', () => {
  it('mascara o miolo do numero mantendo DDD e final', () => {
    expect(maskPhone('21987654321')).toBe('21*****4321');
  });

  it('ignora caracteres nao numericos antes de mascarar', () => {
    expect(maskPhone('(21) 98765-4321')).toBe('21*****4321');
  });

  it('retorna mascara generica para numeros muito curtos', () => {
    expect(maskPhone('123')).toBe('***');
  });
});

describe('maskCpf', () => {
  it('retorna undefined quando nao ha cpf', () => {
    expect(maskCpf(undefined)).toBeUndefined();
  });

  it('mascara o cpf mantendo inicio e final', () => {
    expect(maskCpf('11122233344')).toBe('111.***.***-44');
  });

  it('retorna mascara generica para cpf invalido', () => {
    expect(maskCpf('123')).toBe('***');
  });
});

describe('parsePagination', () => {
  it('usa pagina 1 e pageSize 25 por padrao', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 25, offset: 0 });
  });

  it('calcula o offset a partir da pagina', () => {
    expect(parsePagination({ page: '3', pageSize: '10' })).toEqual({
      page: 3,
      pageSize: 10,
      offset: 20,
    });
  });

  it('limita o pageSize em 500 (teto pensado para vistas amplas tipo Kanban)', () => {
    expect(parsePagination({ pageSize: '999' })).toEqual({ page: 1, pageSize: 500, offset: 0 });
  });

  it('nao aceita pagina menor que 1', () => {
    expect(parsePagination({ page: '0' })).toEqual({ page: 1, pageSize: 25, offset: 0 });
  });
});
