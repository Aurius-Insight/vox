import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { ClassSession, StudentType } from '../api/types';
import { formatDateTime } from '../lib/format';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastProvider';

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

export function PresencaPage() {
  const [classes, setClasses] = useState<ClassSession[]>([]);
  const [pendingKey, setPendingKey] = useState<string>();
  const [addingTo, setAddingTo] = useState<ClassSession>();
  const [studentQuery, setStudentQuery] = useState('');
  const [results, setResults] = useState<StudentResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [bookingId, setBookingId] = useState<string>();
  const toast = useToast();

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

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Coordenacao</p>
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

      {classes.length === 0 && <p className="muted-text">Nenhuma aula cadastrada.</p>}

      <div className="stack">
        {classes.map((classSession) => (
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

            <table>
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
                      <td>{student.name}</td>
                      <td>{student.enrollmentCode}</td>
                      <td>
                        <span className="status-chip">
                          {student.bookingType === 'experimental' ? 'Experimental' : 'Matriculado'}
                        </span>
                      </td>
                      <td>{student.creditBalance}</td>
                      <td>
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
