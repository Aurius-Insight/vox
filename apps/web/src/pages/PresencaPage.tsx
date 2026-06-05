import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { ClassSession, StudentType } from '../api/types';
import { formatDateTime } from '../lib/format';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../auth/AuthProvider';

type AttendanceResponse = {
  data: {
    student: { id: string; name: string; creditBalance: number };
  };
};

type AttendanceStatus = 'presente' | 'no_show';

type StudentResult = {
  id: string;
  name: string;
  type: StudentType;
  enrollmentCode: string;
  creditBalance: number;
  unitName: string | null;
};

type ClassBucket = 'hoje' | 'proximas' | 'historico';

export function PresencaPage() {
  const auth = useAuth();
  const [classes, setClasses] = useState<ClassSession[]>([]);
  const [pendingKey, setPendingKey] = useState<string>();
  const [addingTo, setAddingTo] = useState<ClassSession>();
  const [studentQuery, setStudentQuery] = useState('');
  const [results, setResults] = useState<StudentResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [bookingId, setBookingId] = useState<string>();
  const [tab, setTab] = useState<ClassBucket>('hoje');
  const toast = useToast();

  // Divide as aulas em 3 baldes via startsAt comparado a "hoje" no fuso
  // local. Historico = passadas (ordenadas mais recente -> mais antigo);
  // Hoje = mesmo dia local; Proximas = futuras a partir de amanha.
  const buckets = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const endOfDay = new Date(start);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const hoje: ClassSession[] = [];
    const proximas: ClassSession[] = [];
    const historico: ClassSession[] = [];

    for (const item of classes) {
      const dt = new Date(item.startsAt);
      if (dt < start) historico.push(item);
      else if (dt < endOfDay) hoje.push(item);
      else proximas.push(item);
    }
    // Historico mais recente primeiro pra leitura natural.
    historico.reverse();
    return { hoje, proximas, historico };
  }, [classes]);

  const visibleClasses = buckets[tab];

  const load = useCallback(async () => {
    try {
      const response = await api<{ data: ClassSession[] }>('/api/classes');
      setClasses(response.data);
    } catch {
      toast.error('Nao foi possivel carregar as aulas.');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Busca de alunos (debounce 300ms) enquanto o modal de adicionar esta aberto.
  useEffect(() => {
    const term = studentQuery.trim();
    if (!addingTo || term.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api<{ data: StudentResult[] }>(
          `/api/students/search?q=${encodeURIComponent(term)}`,
        );
        if (active) setResults(response.data);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [studentQuery, addingTo]);

  async function markAttendance(classId: string, studentId: string, status: AttendanceStatus) {
    const key = `${classId}:${studentId}`;
    setPendingKey(key);

    try {
      const response = await api<AttendanceResponse>(`/api/classes/${classId}/attendance`, {
        method: 'POST',
        body: JSON.stringify({ studentId, status }),
      });
      const updated = response.data.student;

      setClasses((current) =>
        current.map((classSession) =>
          classSession.id !== classId
            ? classSession
            : {
                ...classSession,
                bookedStudents: classSession.bookedStudents.map((student) =>
                  student.id === updated.id
                    ? { ...student, creditBalance: updated.creditBalance }
                    : student,
                ),
              },
        ),
      );
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel registrar a presenca.',
      );
    } finally {
      setPendingKey(undefined);
    }
  }

  function openAdd(classSession: ClassSession) {
    setAddingTo(classSession);
    setStudentQuery('');
    setResults([]);
  }

  async function handleBook(student: StudentResult) {
    if (!addingTo) return;
    setBookingId(student.id);
    try {
      await api(`/api/classes/${addingTo.id}/bookings`, {
        method: 'POST',
        body: JSON.stringify({ studentId: student.id }),
      });
      toast.success(`${student.name} agendado na aula.`);
      setAddingTo(undefined);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel agendar o aluno.',
      );
    } finally {
      setBookingId(undefined);
    }
  }

  const term = studentQuery.trim();
  // Alunos ja agendados nesta aula saem da lista de resultados.
  const availableResults = addingTo
    ? results.filter(
        (student) => !addingTo.bookedStudents.some((booked) => booked.id === student.id),
      )
    : [];

  // O professor tambem usa esta tela; "Coordenacao" confundiria. Mostra o
  // papel certo quando o usuario e so professor.
  const isProfessorOnly =
    auth.user?.roles.includes('professor') &&
    !auth.user.roles.some((role) => role === 'diretor' || role === 'coordenacao');

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{isProfessorOnly ? 'Professor' : 'Coordenacao'}</p>
          <h1>Presenca e creditos</h1>
        </div>
      </header>

      {addingTo && (
        <Modal
          title={`Adicionar aluno — ${addingTo.displayName}`}
          onClose={() => setAddingTo(undefined)}
        >
          <label>
            Buscar aluno
            <input
              value={studentQuery}
              onChange={(event) => setStudentQuery(event.target.value)}
              placeholder="Nome ou matricula"
              autoFocus
            />
          </label>
          <div className="stack">
            {term.length < 2 && (
              <p className="muted-text">Digite ao menos 2 letras para buscar.</p>
            )}
            {searching && <p className="muted-text">Buscando...</p>}
            {!searching && term.length >= 2 && availableResults.length === 0 && (
              <p className="muted-text">Nenhum aluno disponivel encontrado.</p>
            )}
            {availableResults.map((student) => (
              <button
                type="button"
                key={student.id}
                className="secondary-button"
                disabled={bookingId === student.id}
                onClick={() => void handleBook(student)}
              >
                {bookingId === student.id
                  ? 'Agendando...'
                  : `${student.name} · ${student.enrollmentCode} · ${
                      student.type === 'experimental' ? 'Experimental' : 'Matriculado'
                    }`}
              </button>
            ))}
          </div>
        </Modal>
      )}

      <nav className="detail-tabs" aria-label="Filtro de aulas">
        <button
          type="button"
          className={tab === 'hoje' ? 'is-active' : ''}
          onClick={() => setTab('hoje')}
        >
          Hoje ({buckets.hoje.length})
        </button>
        <button
          type="button"
          className={tab === 'proximas' ? 'is-active' : ''}
          onClick={() => setTab('proximas')}
        >
          Proximas ({buckets.proximas.length})
        </button>
        <button
          type="button"
          className={tab === 'historico' ? 'is-active' : ''}
          onClick={() => setTab('historico')}
        >
          Historico ({buckets.historico.length})
        </button>
      </nav>

      {classes.length === 0 && <p className="muted-text">Nenhuma aula cadastrada.</p>}
      {classes.length > 0 && visibleClasses.length === 0 && (
        <p className="muted-text">
          {tab === 'hoje'
            ? 'Nenhuma aula hoje.'
            : tab === 'proximas'
              ? 'Nenhuma aula futura agendada.'
              : 'Nenhuma aula no historico.'}
        </p>
      )}

      <div className="stack">
        {visibleClasses.map((classSession) => (
          <section key={classSession.id} className="table-card">
            <div className="table-card-header">
              <div>
                <strong>{classSession.displayName}</strong>
                <span>
                  {classSession.teacherName ? `${classSession.teacherName} - ` : ''}
                  {classSession.unitName ?? 'Sem unidade'} -{' '}
                  {formatDateTime(classSession.startsAt)}
                </span>
              </div>
              <div className="row-actions">
                <span className="status-chip">
                  {classSession.bookedCount}/{classSession.capacity} agendados
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openAdd(classSession)}
                >
                  Adicionar aluno
                </button>
              </div>
            </div>

            <table className="cards-table">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Matricula</th>
                  <th>Tipo</th>
                  <th>Saldo</th>
                  <th>Chamada</th>
                </tr>
              </thead>
              <tbody>
                {classSession.bookedStudents.length === 0 && (
                  <tr>
                    <td colSpan={5}>Nenhum aluno agendado.</td>
                  </tr>
                )}
                {classSession.bookedStudents.map((student) => {
                  const key = `${classSession.id}:${student.id}`;
                  const isPending = pendingKey === key;

                  return (
                    <tr key={student.id}>
                      <td data-label="Aluno">{student.name}</td>
                      <td data-label="Matricula">{student.enrollmentCode}</td>
                      <td data-label="Tipo">
                        <span className="status-chip">
                          {student.bookingType === 'experimental' ? 'Experimental' : 'Matriculado'}
                        </span>
                      </td>
                      <td data-label="Saldo">{student.creditBalance}</td>
                      <td data-label="Chamada">
                        <div className="row-actions">
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              void markAttendance(classSession.id, student.id, 'presente')
                            }
                          >
                            Presente
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={isPending}
                            onClick={() =>
                              void markAttendance(classSession.id, student.id, 'no_show')
                            }
                          >
                            Falta
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </main>
  );
}
