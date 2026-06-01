import { describe, expect, it } from 'vitest';
import { lastPageNumbers } from './botconversa-api.js';

describe('lastPageNumbers', () => {
  it('retorna vazio quando nao ha contatos', () => {
    expect(lastPageNumbers(0, 25)).toEqual([]);
  });

  it('uma unica pagina quando tudo cabe nela', () => {
    expect(lastPageNumbers(25, 25)).toEqual([1]);
    expect(lastPageNumbers(10, 25)).toEqual([1]);
  });

  it('as duas ultimas paginas por padrao', () => {
    expect(lastPageNumbers(26, 25)).toEqual([1, 2]);
    expect(lastPageNumbers(100, 25)).toEqual([3, 4]);
    expect(lastPageNumbers(5961, 25)).toEqual([238, 239]);
  });

  it('respeita o parametro howMany', () => {
    expect(lastPageNumbers(100, 25, 1)).toEqual([4]);
    expect(lastPageNumbers(100, 25, 3)).toEqual([2, 3, 4]);
  });
});
