import { lazy, Suspense } from 'react';
import { MotionConfig } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ToastProvider';
import { firstAccessibleRoute } from './lib/navigation';
import { AgendaPage } from './pages/AgendaPage';
import { AjudaPage } from './pages/AjudaPage';
import { AlunosPage } from './pages/AlunosPage';
import { AtendimentoPage } from './pages/AtendimentoPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';
import { LeadsPage } from './pages/LeadsPage';
import { LoginPage } from './pages/LoginPage';
import { NoAccessPage } from './pages/NoAccessPage';
import { PortalHomePage } from './pages/PortalHomePage';
import { PortalLoginPage } from './pages/PortalLoginPage';
import { PresencaPage } from './pages/PresencaPage';
import { ProfessoresPage } from './pages/ProfessoresPage';
import { UnidadesPage } from './pages/UnidadesPage';

// O Dashboard carrega o Recharts (pesado) — code-split: so baixa quando aberto.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);

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
      <MotionConfig reducedMotion="user">
        <ToastProvider>
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
                <Route
                  path="/dashboard"
                  element={
                    <Suspense
                      fallback={<div className="page-status">Carregando dashboard...</div>}
                    >
                      <DashboardPage />
                    </Suspense>
                  }
                />
              </Route>

              <Route element={<RequireAuth roles={['diretor', 'coordenacao']} />}>
                <Route path="/vendas" element={<LeadsPage />} />
              </Route>

              <Route element={<RequireAuth roles={['diretor', 'coordenacao', 'revisor']} />}>
                <Route path="/atendimento" element={<AtendimentoPage />} />
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
                <Route path="/professores" element={<ProfessoresPage />} />
              </Route>

              <Route element={<RequireAuth roles={['diretor', 'coordenacao']} />}>
                <Route path="/unidades" element={<UnidadesPage />} />
              </Route>

              <Route element={<RequireAuth roles={['diretor']} />}>
                <Route path="/configuracoes" element={<ConfiguracoesPage />} />
              </Route>

              <Route path="/ajuda" element={<AjudaPage />} />
            </Route>
          </Route>
        </Routes>
          </BrowserRouter>
        </ToastProvider>
      </MotionConfig>
    </AuthProvider>
  );
}
