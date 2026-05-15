import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiClientError, api } from '../api/client';

type DisciplinaResumo = {
  disciplina: string;
  quantidade: number;
};

type PortalStudent = {
  name: string;
  unit: string | null;
  packageName: string;
  aulasFeitas: number;
  aulasRestantes: number;
  porDisciplina: DisciplinaResumo[];
};

type PortalClass = {
  id: string;
  displayName: string;
  isGuest: boolean;
  unit: string | null;
  startsAt: string;
  bookedCount: number;
  capacity: number;
  canBook: boolean;
  isBooked: boolean;
};

export function PortalHomePage() {
  const navigate = useNavigate();
  const [student, setStudent] = useState<PortalStudent>();
  const [classes, setClasses] = useState<PortalClass[]>([]);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [me, classList] = await Promise.all([
        api<{ data: PortalStudent }>('/api/portal/me'),
        api<{ data: PortalClass[] }>('/api/portal/classes'),
      ]);
      setStudent(me.data);
      setClasses(classList.data);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setUnauthenticated(true);
        return;
      }
      setError('Nao foi possivel carregar seus dados agora.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleBooking(item: PortalClass) {
    // Decisao do MVP: nao tem cancelamento pelo portal — so reserva.
    if (item.isBooked) return;
    setPendingId(item.id);
    setError('');

    try {
      await api(`/api/portal/classes/${item.id}/book`, { method: 'POST' });
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 401) {
          setUnauthenticated(true);
          return;
        }
        setError(err.message);
      } else {
        setError('Nao foi possivel concluir a operacao.');
      }
    } finally {
      setPendingId(undefined);
    }
  }

  async function handleLogout() {
    try {
      await api('/api/portal/logout', { method: 'POST' });
    } catch {
      // sessao ja pode estar expirada; segue para a tela de acesso de qualquer forma
    }
    navigate('/portal/entrar', { replace: true });
  }

  if (unauthenticated) return <Navigate to="/portal/entrar" replace />;

  return (
    <main className="app-page portal-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Portal do aluno</p>
          <h1>Ola, {student?.name ?? 'aluno'}</h1>
        </div>
        <button type="button" className="secondary-button" onClick={() => void handleLogout()}>
          Sair
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}

      <section className="portal-top-grid">
        <div className="portal-hero">
          <p className="eyebrow">Suas aulas</p>
          <h1>O palco e seu</h1>
          <p>
            Acompanhe quantas aulas voce ja fez, de quais disciplinas, e agende as proximas sem
            depender do atendimento.
          </p>
        </div>
        <aside className="credit-panel">
          <div className="credit-panel-label">
            <span>Aulas restantes</span>
            <span>Vox RJ</span>
          </div>
          <div className="credit-panel-value">
            <strong>{String(student?.aulasRestantes ?? '-').padStart(2, '0')}</strong>
            <span>aulas</span>
          </div>
          <p className="credit-panel-note">
            {student ? `${student.aulasFeitas} aulas feitas - ${student.packageName}` : 'Pacote ativo'}
          </p>
        </aside>
      </section>

      <section className="portal-section">
        <div className="section-title">
          <h2>Minhas disciplinas</h2>
        </div>
        {student && student.porDisciplina.length === 0 && (
          <p className="empty-state">Nenhuma aula registrada ainda.</p>
        )}
        <ul className="history-list">
          {student?.porDisciplina.map((item) => (
            <li key={item.disciplina}>
              <span>{item.disciplina}</span>
              <span>
                {item.quantidade} {item.quantidade === 1 ? 'aula feita' : 'aulas feitas'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="portal-section">
        <div className="section-title">
          <h2>Proximas aulas</h2>
        </div>
        <div className="class-list">
          {classes.length === 0 && <p className="empty-state">Nenhuma aula disponivel no momento.</p>}
          {classes.map((item) => {
            const isPending = pendingId === item.id;
            const buttonDisabled = isPending || !item.canBook;

            return (
              <article key={item.id} className="class-card">
                <div className="class-date">
                  <span>{formatMonth(item.startsAt)}</span>
                  <strong>{formatDay(item.startsAt)}</strong>
                </div>
                <div className="class-info">
                  <span className="status-chip">{item.isBooked ? 'Confirmada' : 'Disponivel'}</span>
                  <strong>{item.displayName}</strong>
                  <span>
                    {formatTime(item.startsAt)} - {item.unit ?? 'Sem unidade'} -{' '}
                    {item.bookedCount}/{item.capacity} vagas
                  </span>
                </div>
                {item.isBooked ? (
                  // Aluno ja agendou: a aula nao pode mais ser cancelada pelo portal.
                  <span className="class-confirmed">Reservada</span>
                ) : (
                  <button
                    type="button"
                    disabled={buttonDisabled}
                    onClick={() => void handleBooking(item)}
                  >
                    {isPending ? 'Processando...' : item.canBook ? 'Usar 1 aula' : 'Indisponivel'}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function formatDay(value: string) {
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit' });
}

function formatMonth(value: string) {
  return new Date(value).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
