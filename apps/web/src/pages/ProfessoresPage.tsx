import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api/client';
import type { AppUser, Subject, TeachingHistory, Unit } from '../api/types';
import { TeachingHistoryView } from '../components/TeacherHistoryView';
import { useToast } from '../components/ToastProvider';

// Destaca o trecho que casou com a busca atual. Mesmo padrao da AlunosPage —
// se for usado em mais lugares, promover pra util compartilhado.
function highlightMatch(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const lower = text.toLowerCase();
  const needle = trimmed.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

export function ProfessoresPage() {
  const [teachers, setTeachers] = useState<AppUser[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [history, setHistory] = useState<TeachingHistory>();
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const toast = useToast();

  // Filtros aplicados client-side sobre a lista carregada — sao poucos
  // professores (dezenas), entao memoria basta.
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('');
  const [subjectFilter, setSubjectFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativos' | 'inativos'>('ativos');

  const loadTeachers = useCallback(async () => {
    setLoadingList(true);
    try {
      const [teacherList, subjectList, unitList] = await Promise.all([
        api<{ data: AppUser[] }>('/api/users?role=professor'),
        api<{ data: Subject[] }>('/api/subjects'),
        api<{ data: Unit[] }>('/api/units'),
      ]);
      setTeachers(teacherList.data);
      setSubjects(subjectList.data);
      setUnits(unitList.data);
    } catch {
      toast.error('Nao foi possivel carregar os professores.');
    } finally {
      setLoadingList(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadTeachers();
  }, [loadTeachers]);

  const visibleTeachers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return teachers.filter((teacher) => {
      if (statusFilter === 'ativos' && !teacher.active) return false;
      if (statusFilter === 'inativos' && teacher.active) return false;
      if (subjectFilter && teacher.subjectId !== subjectFilter) return false;
      if (unitFilter && teacher.unitId !== unitFilter) return false;
      if (query) {
        const haystack = `${teacher.name} ${teacher.email}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [teachers, search, unitFilter, subjectFilter, statusFilter]);

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
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Professores</p>
          <h1>Perfil do professor</h1>
        </div>
      </header>

      <div className="filter-bar" role="search">
        <label className="filter-bar-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar professor por nome ou e-mail"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar professor"
          />
        </label>
        <select
          className="filter-bar-select"
          value={unitFilter}
          onChange={(event) => setUnitFilter(event.target.value)}
          aria-label="Filtrar por escola"
        >
          <option value="">Todas as escolas</option>
          {units
            .filter((unit) => unit.active)
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
        </select>
        <select
          className="filter-bar-select"
          value={subjectFilter}
          onChange={(event) => setSubjectFilter(event.target.value)}
          aria-label="Filtrar por materia"
        >
          <option value="">Todas as materias</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
        <select
          className="filter-bar-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          aria-label="Filtrar por status"
        >
          <option value="ativos">Ativos</option>
          <option value="inativos">Inativos</option>
          <option value="todos">Todos</option>
        </select>
        <span className="filter-bar-count">
          {visibleTeachers.length === teachers.length
            ? `${teachers.length} professores`
            : `${visibleTeachers.length} de ${teachers.length}`}
        </span>
      </div>

      <div className={selectedId ? 'split-grid' : 'split-grid split-grid-collapsed'}>
        <section className="table-card">
          {loadingList && <p className="muted-text">Carregando professores...</p>}
          {!loadingList && (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Materia</th>
                  <th>Escola</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleTeachers.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      {teachers.length === 0
                        ? 'Nenhum professor cadastrado.'
                        : 'Nenhum professor encontrado com esses filtros.'}
                    </td>
                  </tr>
                )}
                {visibleTeachers.map((teacher) => (
                  <tr
                    key={teacher.id}
                    onClick={() => void openTeacher(teacher.id)}
                    className={teacher.id === selectedId ? 'row-selected' : undefined}
                  >
                    <td>{highlightMatch(teacher.name, search)}</td>
                    <td>{teacher.subject?.name ?? '-'}</td>
                    <td>{teacher.unit?.name ?? '-'}</td>
                    <td>
                      <span className="status-chip">
                        {teacher.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {selectedId && (
          <aside className="detail-card">
            {loadingDetail && <p className="muted-text">Carregando historico...</p>}
            {history && !loadingDetail && (
              <div className="stack">
                <div>
                  <p className="eyebrow">{history.teacher.subject?.name ?? 'Sem materia'}</p>
                  <h2>{history.teacher.name}</h2>
                  <span className="status-chip">
                    {history.teacher.active ? 'Ativo' : 'Inativo'}
                  </span>
                  <p className="muted-text">
                    {history.teacher.unit?.name ?? 'Sem unidade'}
                  </p>
                </div>
                <TeachingHistoryView history={history} />
              </div>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
