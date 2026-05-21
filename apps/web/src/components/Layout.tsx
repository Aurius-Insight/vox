import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Building2,
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Settings,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { navItemsForRoles } from '../lib/navigation';
import { ThemeToggle } from './ThemeToggle';

// Icone de cada item do menu, por rota.
const NAV_ICONS: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/vendas': TrendingUp,
  '/coordenacao': CalendarDays,
  '/coordenacao/presenca': ClipboardCheck,
  '/alunos': GraduationCap,
  '/unidades': Building2,
  '/configuracoes': Settings,
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('vox-sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

export function Layout() {
  const auth = useAuth();
  const location = useLocation();
  const roles = auth.user?.roles ?? [];
  const items = navItemsForRoles(roles);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem('vox-sidebar', collapsed ? 'collapsed' : 'expanded');
    } catch {
      // localStorage indisponivel — segue sem persistir.
    }
  }, [collapsed]);

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <aside className="app-sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark">Vox RJ</span>
            <span className="brand-sub sidebar-label">Sistema interno</span>
          </div>
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
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {Icon && <Icon className="nav-icon" size={18} />}
                <span className="sidebar-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="app-user">
          <div className="app-user-info sidebar-label">
            <strong>{auth.user?.name ?? 'Usuario'}</strong>
            <span>{roles.join(', ') || 'sem papel'}</span>
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
