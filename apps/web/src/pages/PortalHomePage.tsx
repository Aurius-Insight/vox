import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiClientError, api } from '../api/client';
import { ThemeToggle } from '../components/ThemeToggle';

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

type HistoryStatus = 'presente' | 'no_show' | 'cancelado' | 'sem_registro';

type PortalHistoryItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  displayName: string;
  unit: string | null;
  teacher: string | null;
  status: HistoryStatus;
  creditConsumed: boolean;
};

const HISTORY_STATUS_LABEL: Record<HistoryStatus, string> = {
  presente: 'Presente',
  no_show: 'Falta',
  cancelado: 'Cancelada',
  sem_registro: 'Sem registro',
};

export function PortalHomePage() {
  const navigate = useNavigate();
  const [student, setStudent] = useState<PortalStudent>();
  const [classes, setClasses] = useState<PortalClass[]>([]);
  const [history, setHistory] = useState<PortalHistoryItem[]>([]);
  const [tab, setTab] = useState<'proximas' | 'historico'>('proximas');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState('');

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
    } finally {
      setLoading(false);
    }
  }, []);

  // Historico tem lazy load — so busca quando o aluno trocar pra tab. Evita
  // payload extra no primeiro paint do portal (caminho mais comum: agendar).
  const loadHistory = useCallback(async () => {
    try {
      const response = await api<{ data: PortalHistoryItem[] }>('/api/portal/history');
      setHistory(response.data);
      setHistoryLoaded(true);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setUnauthenticated(true);
        return;
      }
      setError('Nao foi possivel carregar o historico.');
    }
  }, []);

  useEffect(() => {
    if (tab === 'historico' && !historyLoaded) {
      void loadHistory();
    }
  }, [tab, historyLoaded, loadHistory]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleBooking(item: PortalClass) {
    setPendingId(item.id);
    setError('');
    setFlash('');

    try {
      await api(`/api/portal/classes/${item.id}/book`, {
        method: item.isBooked ? 'DELETE' : 'POST',
      });
      await load();
      setFlash(item.isBooked ? 'Reserva cancelada.' : 'Aula confirmada! ✓');
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
        <div className="row-actions">
          <ThemeToggle />
          <button type="button" className="secondary-button" onClick={() => void handleLogout()}>
            Sair
          </button>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}
      {flash && <p className="form-success">{flash}</p>}

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
            <span>Vox Rio</span>
          </div>
          <div
            className="credit-panel-value"
            data-tone={student?.aulasRestantes === 0 ? 'alert' : undefined}
          >
            <strong>{student ? String(student.aulasRestantes).padStart(2, '0') : '—'}</strong>
            <span>aulas</span>
          </div>
          <p className="credit-panel-note">
            {!student
              ? 'Carregando...'
              : student.aulasRestantes === 0
                ? 'Sem aulas no pacote - fale com o atendimento'
                : `${student.aulasFeitas} aulas feitas - ${student.packageName}`}
          </p>
        </aside>
      </section>

      <section className="portal-section">
        <div className="section-title">
          <h2>Minhas aulas</h2>
          <nav className="detail-tabs" aria-label="Filtro de aulas">
            <button
              type="button"
              className={tab === 'proximas' ? 'is-active' : ''}
              onClick={() => setTab('proximas')}
            >
              Proximas
            </button>
            <button
              type="button"
              className={tab === 'historico' ? 'is-active' : ''}
              onClick={() => setTab('historico')}
            >
              Historico
            </button>
          </nav>
        </div>

        {tab === 'historico' && (
          <div className="class-list">
            {!historyLoaded && <p className="empty-state">Carregando historico...</p>}
            {historyLoaded && history.length === 0 && (
              <p className="empty-state">Nenhuma aula no seu historico ainda.</p>
            )}
            {history.map((item) => (
              <article key={item.id} className="class-card">
                <div className="class-date">
                  <span>{formatMonth(item.startsAt)}</span>
                  <strong>{formatDay(item.startsAt)}</strong>
                </div>
                <div className="class-info">
                  <span
                    className="status-chip"
                    data-status={item.status}
                  >
                    {HISTORY_STATUS_LABEL[item.status]}
                  </span>
                  <strong>{item.displayName}</strong>
                  <span>
                    {formatTime(item.startsAt)} - {item.unit ?? 'Sem unidade'}
                    {item.teacher ? ` - ${item.teacher}` : ''}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === 'proximas' && (
        <div className="class-list">
          {loading && <p className="empty-state">Carregando aulas...</p>}
          {!loading && classes.length === 0 && (
            <p className="empty-state">Nenhuma aula disponivel no momento.</p>
          )}
          {classes.map((item) => {
            const isPending = pendingId === item.id;
            const actionDisabled = isPending || (!item.isBooked && !item.canBook);

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
                <button
                  type="button"
                  className={item.isBooked ? 'secondary-button' : undefined}
                  disabled={actionDisabled}
                  onClick={() => void handleBooking(item)}
                >
                  {isPending
                    ? 'Processando...'
                    : item.isBooked
                      ? 'Cancelar'
                      : item.canBook
                        ? 'Usar 1 aula'
                        : 'Indisponivel'}
                </button>
              </article>
            );
          })}
        </div>
        )}
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
