import { describe, expect, it } from 'vitest';
import { hasRoleAccess, isProfessorScoped, resolveUnitScope } from './access.js';

describe('hasRoleAccess', () => {
  it('libera quando ha interseccao de papeis', () => {
    expect(hasRoleAccess(['professor'], ['diretor', 'coordenacao', 'professor'])).toBe(true);
  });

  it('libera quando o usuario tem varios papeis e um deles bate', () => {
    expect(hasRoleAccess(['professor', 'coordenacao'], ['diretor', 'coordenacao'])).toBe(true);
  });

  it('bloqueia quando nao ha interseccao', () => {
    expect(hasRoleAccess(['professor'], ['diretor', 'coordenacao'])).toBe(false);
  });

  it('bloqueia usuario sem papel algum', () => {
    expect(hasRoleAccess([], ['diretor'])).toBe(false);
  });
});

describe('isProfessorScoped', () => {
  it('professor puro tem escopo restrito', () => {
    expect(isProfessorScoped(['professor'])).toBe(true);
  });

  it('professor que tambem e coordenacao tem visao ampla', () => {
    expect(isProfessorScoped(['professor', 'coordenacao'])).toBe(false);
  });

  it('professor que tambem e diretor tem visao ampla', () => {
    expect(isProfessorScoped(['professor', 'diretor'])).toBe(false);
  });

  it('quem nao e professor nunca tem escopo de professor', () => {
    expect(isProfessorScoped(['diretor'])).toBe(false);
    expect(isProfessorScoped(['coordenacao'])).toBe(false);
    expect(isProfessorScoped([])).toBe(false);
  });
});

describe('resolveUnitScope', () => {
  it('diretor tem visao global mesmo com unidade vinculada', () => {
    expect(resolveUnitScope({ roles: ['diretor'], unitId: 'unit_centro' })).toBeNull();
  });

  it('coordenacao com unidade fica restrita a ela', () => {
    expect(resolveUnitScope({ roles: ['coordenacao'], unitId: 'unit_centro' })).toBe('unit_centro');
  });

  it('coordenacao sem unidade vinculada ve tudo', () => {
    expect(resolveUnitScope({ roles: ['coordenacao'], unitId: null })).toBeNull();
  });

  it('professor com unidade fica restrito a ela', () => {
    expect(resolveUnitScope({ roles: ['professor'], unitId: 'unit_barra' })).toBe('unit_barra');
  });
});
