import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AppUser, TeachingHistory } from '../api/types';
import { TeachingHistoryView } from '../components/TeacherHistoryView';
import { useToast } from '../components/ToastProvider';

export function ProfessoresPage() {
  const [teachers, setTeachers] = useState<AppUser[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [history, setHistory] = useState<TeachingHistory>();
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const toast = useToast();

  const loadTeachers = useCallback(async () => {
    setLoadingList(true);
    try {
      const response = await api<{ data: AppUser[] }>('/api/users?role=professor');
      setTeachers(response.data);
    } catch {
      toast.error('Nao foi possivel carregar os professores.');
    } finally {
      setLoadingList(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadTeachers();
  }, [loadTeachers]);

  async function openTeacher(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    setHistory(undefined);
    try {
      const response = await api<{ data: TeachingHistory }>(
        `/api/users/${id}/teaching-history`,
      );
      setHistory(response.data);
    } catch {
      toast.error('Nao foi possivel carregar o historico do professor.');
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Professores</h1>
          <p className="muted-text">
            Perfil de cada professor — aulas dadas, alunos atendidos e pontualidade.
          </p>
        </div>
      </header>

      <div className="split-grid">
        <section className="table-card">
          {loadingList && <p className="muted-text">Carregando professores...</p>}
          {!loadingList && teachers.length === 0 && (
            <p className="muted-text">Nenhum professor cadastrado.</p>
          )}
          {!loadingList && teachers.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Materia</th>
                  <th>Unidade</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((teacher) => (
                  <tr
                    key={teacher.id}
                    onClick={() => void openTeacher(teacher.id)}
                    className={teacher.id === selectedId ? 'row-selected' : undefined}
                  >
                    <td>{teacher.name}</td>
                    <td>{teacher.subject?.name ?? '-'}</td>
                    <td>{teacher.unit?.name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="detail-card">
          {!selectedId && !loadingDetail && (
            <p className="muted-text">Selecione um professor para ver o historico.</p>
          )}
          {loadingDetail && <p className="muted-text">Carregando historico...</p>}
          {history && !loadingDetail && (
            <div className="stack">
              <div>
                <p className="eyebrow">{history.teacher.subject?.name ?? 'Sem materia'}</p>
                <h2>{history.teacher.name}</h2>
                <p className="muted-text">
                  {history.teacher.unit?.name ?? 'Sem unidade'}
                  {history.teacher.active ? '' : ' - inativo'}
                </p>
              </div>
              <TeachingHistoryView history={history} />
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
