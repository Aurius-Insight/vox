import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  MessageCircle,
  PanelLeft,
  Presentation,
  Settings,
  TrendingUp,
  UserCircle,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth, type Role } from '../auth/AuthProvider';
import { firstAccessibleRoute, navItemsForRoles } from '../lib/navigation';
import { api } from '../api/client';
import { ThemeToggle } from './ThemeToggle';
import { useToast } from './ToastProvider';

// Icone de cada item do menu, por rota.
const NAV_ICONS: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/vendas': TrendingUp,
  '/atendimento': MessageCircle,
  '/coordenacao': CalendarDays,
  '/coordenacao/presenca': ClipboardCheck,
  '/alunos': GraduationCap,
  '/professores': Presentation,
  '/unidades': Building2,
  '/materias': BookOpen,
  '/configuracoes': Settings,
  '/perfil': UserCircle,
  '/ajuda': LifeBuoy,
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('vox-sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

const VIEW_AS_ROLES: { value: Role; label: string }[] = [
  { value: 'diretor', label: 'Diretor (voce)' },
  { value: 'coordenacao', label: 'Coordenacao' },
  { value: 'professor', label: 'Professor' },
];

export function Layout() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const roles = auth.user?.roles ?? [];
  const isDiretor = roles.includes('diretor');
  // "Ver como": o diretor pode enxergar o menu como cada papel (so visual —
  // o backend mantem as permissoes reais). null = visao real.
  const [viewAs, setViewAs] = useState<Role | null>(null);
  const items = navItemsForRoles(viewAs ? [viewAs] : roles);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Drawer do menu no mobile (off-canvas). No desktop o sidebar e fixo.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('vox-sidebar', collapsed ? 'collapsed' : 'expanded');
    } catch {
      // localStorage indisponivel — segue sem persistir.
    }
  }, [collapsed]);

  // Fecha o drawer ao navegar (mobile).
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell" data-collapsed={collapsed} data-drawer={drawerOpen}>
      {/* Barra superior so no mobile: hamburguer + marca (CSS esconde no desktop). */}
      <header className="app-topbar">
        <button
          type="button"
          className="app-topbar-burger"
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir menu"
        >
          <Menu size={22} />
        </button>
        <span className="brand-mark">Vox Rio</span>
      </header>

      {/* Backdrop do drawer (mobile) — clicar fecha. */}
      <button
        type="button"
        className="app-drawer-overlay"
        aria-label="Fechar menu"
        tabIndex={-1}
        onClick={() => setDrawerOpen(false)}
      />

      <aside className="app-sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark">Vox Rio</span>
            <span className="brand-sub sidebar-label">Sistema interno</span>
          </div>
          <button
            type="button"
            className="sidebar-drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Fechar menu"
            title="Fechar menu"
          >
            <X size={18} />
          </button>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expandir menu' : 'Retrair menu'}
            title={collapsed ? 'Expandir menu' : 'Retrair menu'}
          >
            <PanelLeft size={18} />
          </button>
        </div>

        <nav className="app-nav">
          {items.map((item) => {
            const Icon = NAV_ICONS[item.to];
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end
                title={item.label}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {Icon && <Icon className="nav-icon" size={18} />}
                <span className="sidebar-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="app-user">
          {isDiretor && (
            <label className="view-as sidebar-label">
              Ver como
              <select
                value={viewAs ?? 'diretor'}
                onChange={(event) => {
                  const value = event.target.value;
                  // Aluno e o PORTAL (area separada): abre uma previa em nova
                  // aba via sessao de portal de um aluno de exemplo.
                  if (value === 'aluno') {
                    const previewTab = window.open('', '_blank');
                    api<{ data: { studentName: string } }>('/api/portal/preview', {
                      method: 'POST',
                    })
                      .then((response) => {
                        toast.success(`Previa do portal como ${response.data.studentName}.`);
                        if (previewTab) previewTab.location.href = '/portal';
                        else window.open('/portal', '_blank', 'noopener');
                      })
                      .catch(() => {
                        if (previewTab) previewTab.close();
                        toast.error('Nao foi possivel abrir a previa do portal.');
                      });
                    return;
                  }
                  const role = value as Role;
                  const next = role === 'diretor' ? null : role;
                  setViewAs(next);
                  setDrawerOpen(false);
                  navigate(firstAccessibleRoute(next ? [next] : roles));
                }}
              >
                {VIEW_AS_ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value="aluno">Aluno (portal)</option>
              </select>
            </label>
          )}
          <div className="app-user-info sidebar-label">
            <strong>{auth.user?.name ?? 'Usuario'}</strong>
            <span>
              {viewAs ? `vendo como ${viewAs}` : roles.join(', ') || 'sem papel'}
            </span>
          </div>
          <ThemeToggle />
          <button
            type="button"
            className="secondary-button sidebar-action"
            onClick={() => void auth.logout()}
            title="Sair"
          >
            <LogOut size={16} />
            <span className="sidebar-label">Sair</span>
          </button>
        </div>
      </aside>

      <div className="app-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
