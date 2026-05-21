import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { navItemsForRoles } from '../lib/navigation';
import { ThemeToggle } from './ThemeToggle';

export function Layout() {
  const auth = useAuth();
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
        <Outlet />
      </div>
    </div>
  );
}
