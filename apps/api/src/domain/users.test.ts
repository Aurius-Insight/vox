import { describe, expect, it } from 'vitest';
import { checkUserUpdateGuard } from './users.js';

describe('checkUserUpdateGuard', () => {
  it('libera qualquer alteracao em outro usuario', () => {
    expect(
      checkUserUpdateGuard({ isSelf: false, nextActive: false, nextRoles: ['professor'] }),
    ).toEqual({ ok: true });
  });

  it('bloqueia o diretor de desativar a propria conta', () => {
    expect(checkUserUpdateGuard({ isSelf: true, nextActive: false })).toEqual({
      ok: false,
      reason: 'self_deactivation',
    });
  });

  it('bloqueia o diretor de remover o proprio papel de diretor', () => {
    expect(checkUserUpdateGuard({ isSelf: true, nextRoles: ['coordenacao'] })).toEqual({
      ok: false,
      reason: 'self_diretor_removal',
    });
  });

  it('libera o diretor de editar a si mesmo mantendo o papel diretor', () => {
    expect(
      checkUserUpdateGuard({
        isSelf: true,
        nextActive: true,
        nextRoles: ['diretor', 'coordenacao'],
      }),
    ).toEqual({ ok: true });
  });

  it('libera alteracoes que nao tocam em active nem em roles', () => {
    expect(checkUserUpdateGuard({ isSelf: true })).toEqual({ ok: true });
  });
});
