import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { ClassSession } from '../api/types';
import { formatDateTime } from '../lib/format';

type AttendanceResponse = {
  data: {
    student: { id: string; name: string; creditBalance: number };
  };
};

type AttendanceStatus = 'presente' | 'no_show';

export function PresencaPage() {
  const [classes, setClasses] = useState<ClassSession[]>([]);
  const [error, setError] = useState('');
  const [pendingKey, setPendingKey] = useState<string>();

  const load = useCallback(async () => {
    try {
      const response = await api<{ data: ClassSession[] }>('/api/classes');
      setClasses(response.data);
    } catch {
      setError('Nao foi possivel carregar as aulas.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAttendance(classId: string, studentId: string, status: AttendanceStatus) {
    const key = `${classId}:${studentId}`;
    setPendingKey(key);
    setError('');

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
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Nao foi possivel registrar a presenca.');
      }
    } finally {
      setPendingKey(undefined);
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Coordenacao</p>
          <h1>Presenca e creditos</h1>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}

      {classes.length === 0 && <p className="muted-text">Nenhuma aula com alunos agendados.</p>}

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
              <span className="status-chip">
                {classSession.bookedCount}/{classSession.capacity} agendados
              </span>
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
