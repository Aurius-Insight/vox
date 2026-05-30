import type { Role } from '../auth/AuthProvider';

export type NavItem = {
  to: string;
  label: string;
  roles: Role[];
};

/** Itens do menu lateral, na ordem de exibicao. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', roles: ['diretor'] },
  { to: '/vendas', label: 'Vendas', roles: ['diretor', 'coordenacao'] },
  { to: '/coordenacao', label: 'Agenda', roles: ['diretor', 'coordenacao'] },
  {
    to: '/coordenacao/presenca',
    label: 'Presenca',
    roles: ['diretor', 'coordenacao', 'professor'],
  },
  { to: '/alunos', label: 'Alunos', roles: ['diretor', 'coordenacao'] },
  { to: '/professores', label: 'Professores', roles: ['diretor', 'coordenacao'] },
  { to: '/unidades', label: 'Escolas', roles: ['diretor', 'coordenacao'] },
  { to: '/configuracoes', label: 'Configuracoes', roles: ['diretor'] },
  { to: '/ajuda', label: 'Ajuda', roles: ['diretor', 'coordenacao', 'professor'] },
];

/** Itens do menu que o usuario pode acessar, dado o conjunto de papeis. */
export function navItemsForRoles(roles: Role[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.some((role) => roles.includes(role)));
}

/**
 * Primeira rota que o usuario pode acessar — usada para decidir o destino
 * apos o login e ao acessar a raiz. Garante que cada papel caia numa pagina
 * que de fato pode ver (ex.: professor vai direto para Presenca).
 */
export function firstAccessibleRoute(roles: Role[]): string {
  return navItemsForRoles(roles)[0]?.to ?? '/sem-acesso';
}
