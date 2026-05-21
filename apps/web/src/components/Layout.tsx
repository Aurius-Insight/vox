import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../auth/AuthProvider';
import { navItemsForRoles } from '../lib/navigation';
import { ThemeToggle } from './ThemeToggle';

export function Layout() {
  const auth = useAuth();
  const location = useLocation();
  const roles = auth.user?.roles ?? [];
  const items = navItemsForRoles(roles);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand">
          <span className="brand-mark">Vox RJ</span>
          <span className="brand-sub">Sistema interno</span>
        </div>

        <nav className="app-nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="app-user">
          <div className="app-user-info">
            <strong>{auth.user?.name ?? 'Usuario'}</strong>
            <span>{roles.join(', ') || 'sem papel'}</span>
          </div>
          <ThemeToggle />
          <button type="button" className="secondary-button" onClick={() => void auth.logout()}>
            Sair
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
