import type { Role } from '@prisma/client';

// Papeis que enxergam todas as aulas (nao ficam restritos como o professor).
const BROAD_ACCESS_ROLES: Role[] = ['diretor', 'coordenacao'];

/** O usuario tem acesso se possui pelo menos um dos papeis permitidos. */
export function hasRoleAccess(userRoles: Role[], allowedRoles: Role[]): boolean {
  return userRoles.some((role) => allowedRoles.includes(role));
}

/**
 * Professor "puro": tem o papel professor e nenhum papel de visao ampla.
 * Esse usuario so enxerga e marca presenca das proprias aulas; diretor e
 * coordenacao tem visao de todas as aulas.
 */
export function isProfessorScoped(roles: Role[]): boolean {
  const hasBroadAccess = roles.some((role) => BROAD_ACCESS_ROLES.includes(role));
  return roles.includes('professor') && !hasBroadAccess;
}

/**
 * Unidade pela qual o usuario deve ser filtrado (permissao por unidade).
 * O diretor tem visao global da rede (retorna null = sem restricao).
 * coordenacao e professor com unidade vinculada ficam restritos a ela.
 */
export function resolveUnitScope(input: { roles: Role[]; unitId: string | null }): string | null {
  const hasGlobalView = input.roles.includes('diretor');
  return hasGlobalView ? null : input.unitId;
}
