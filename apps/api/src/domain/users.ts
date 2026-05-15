export type UserUpdateGuard =
  | { ok: true }
  | { ok: false; reason: 'self_deactivation' | 'self_diretor_removal' };

/**
 * Impede que um diretor se tranque para fora do sistema ao editar a propria
 * conta: nao pode se desativar nem remover o proprio papel de diretor.
 */
export function checkUserUpdateGuard(input: {
  isSelf: boolean;
  nextActive?: boolean;
  nextRoles?: string[];
}): UserUpdateGuard {
  if (!input.isSelf) return { ok: true };

  if (input.nextActive === false) {
    return { ok: false, reason: 'self_deactivation' };
  }

  if (input.nextRoles && !input.nextRoles.includes('diretor')) {
    return { ok: false, reason: 'self_diretor_removal' };
  }

  return { ok: true };
}
