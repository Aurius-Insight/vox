import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { firstAccessibleRoute } from './lib/navigation';
import { AgendaPage } from './pages/AgendaPage';
import { AlunosPage } from './pages/AlunosPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';
import { DashboardPage } from './pages/DashboardPage';
import { LeadsPage } from './pages/LeadsPage';
import { LoginPage } from './pages/LoginPage';
import { NoAccessPage } from './pages/NoAccessPage';
import { PortalHomePage } from './pages/PortalHomePage';
import { PortalLoginPage } from './pages/PortalLoginPage';
import { PresencaPage } from './pages/PresencaPage';
import { UnidadesPage } from './pages/UnidadesPage';

/** Decide o destino da raiz conforme a sessao e os papeis do usuario. */
function HomeRedirect() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <div className="page-status">Carregando sessao...</div>;
  }

  if (auth.status === 'guest') {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={firstAccessibleRoute(auth.user?.roles ?? [])} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/portal/entrar" element={<PortalLoginPage />} />
          <Route path="/portal" element={<PortalHomePage />} />

          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/sem-acesso" element={<NoAccessPage />} />

              <Route element={<RequireAuth roles={['diretor']} />}>
                <Route path="/dashboard" element={<DashboardPage />} />
              </Route>

              <Route element={<RequireAuth roles={['diretor', 'coordenacao']} />}>
                <Route path="/vendas" element={<LeadsPage />} />
              </Route>

              <Route element={<RequireAuth roles={['diretor', 'coordenacao']} />}>
                <Route path="/coordenacao" element={<AgendaPage />} />
              </Route>

              <Route
                element={<RequireAuth roles={['diretor', 'coordenacao', 'professor']} />}
              >
                <Route path="/coordenacao/presenca" element={<PresencaPage />} />
              </Route>

              <Route element={<RequireAuth roles={['diretor', 'coordenacao']} />}>
                <Route path="/alunos" element={<AlunosPage />} />
              </Route>

              <Route element={<RequireAuth roles={['diretor', 'coordenacao']} />}>
                <Route path="/unidades" element={<UnidadesPage />} />
              </Route>

              <Route element={<RequireAuth roles={['diretor']} />}>
                <Route path="/configuracoes" element={<ConfiguracoesPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
