import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, type Role } from './AuthProvider';

export function RequireAuth({ roles }: { roles?: Role[] }) {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <div className="page-status">Carregando sessao...</div>;
  }

  if (auth.status === 'guest') {
    return <Navigate to="/login" replace />;
  }

  if (roles?.length) {
    const allowed = auth.user?.roles.some((role) => roles.includes(role));
    if (!allowed) return <Navigate to="/sem-acesso" replace />;
  }

  return <Outlet />;
}
