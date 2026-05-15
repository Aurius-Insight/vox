import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { firstAccessibleRoute } from '../lib/navigation';

export function NoAccessPage() {
  const auth = useAuth();
  const home = firstAccessibleRoute(auth.user?.roles ?? []);

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Permissao</p>
          <h1>Sem acesso</h1>
        </div>
      </header>

      <p className="muted-text">
        Seu usuario nao tem permissao para ver esta pagina. Use o menu lateral ou volte para uma
        area disponivel.
      </p>

      <p>
        <Link to={home}>Ir para uma area disponivel</Link>
      </p>
    </main>
  );
}
