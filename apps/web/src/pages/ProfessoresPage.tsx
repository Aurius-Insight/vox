import type React from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ApiClientError, api } from '../api/client';
import type { AppUser, Subject, TeachingHistory, Unit } from '../api/types';
import { Modal } from '../components/Modal';
import { TeachingHistoryView } from '../components/TeacherHistoryView';
import { useToast } from '../components/ToastProvider';

type TeacherForm = {
  name: string;
  email: string;
  password: string;
  subjectId: string;
  unitId: string;
};

const EMPTY_FORM: TeacherForm = { name: '', email: '', password: '', subjectId: '', unitId: '' };

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

  // Cadastro/edicao de professor (mesmo padrao das Escolas).
  const [form, setForm] = useState<TeacherForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string>();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string>();

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

  function updateField(field: keyof TeacherForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  // Em vez de cadastrar manualmente, envia o link publico de cadastro de
  // professor (a pessoa cria a propria conta com materia/senha).
  async function copyCadastroLink() {
    const url = `${window.location.origin}/cadastro-professor`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link de cadastro de professor copiado!');
    } catch {
      toast.error('Nao foi possivel copiar: ' + url);
    }
  }

  function startEdit(teacher: AppUser) {
    setEditingId(teacher.id);
    setForm({
      name: teacher.name,
      email: teacher.email,
      password: '',
      subjectId: teacher.subjectId ?? '',
      unitId: teacher.unitId ?? '',
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(undefined);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const isEdit = Boolean(editingId);

    if (form.name.trim().length < 2) {
      toast.error('Informe o nome do professor.');
      return;
    }
    if (!form.subjectId) {
      toast.error('Selecione a materia do professor.');
      return;
    }
    if (!isEdit) {
      if (!form.email.trim()) {
        toast.error('Informe o e-mail.');
        return;
      }
      if (form.password.length < 12) {
        toast.error('A senha precisa de ao menos 12 caracteres.');
        return;
      }
    } else if (form.password && form.password.length < 12) {
      toast.error('A nova senha precisa de ao menos 12 caracteres.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        // E-mail nao e editavel pela API; senha so vai se preenchida.
        const payload: Record<string, unknown> = {
          name: form.name.trim(),
          subjectId: form.subjectId,
          unitId: form.unitId || null,
        };
        if (form.password) payload.password = form.password;
        await api(`/api/users/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
            roles: ['professor'],
            subjectId: form.subjectId,
            unitId: form.unitId || undefined,
          }),
        });
      }
      toast.success(isEdit ? 'Professor atualizado.' : 'Professor criado.');
      closeForm();
      await loadTeachers();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Nao foi possivel salvar o professor.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(teacher: AppUser) {
    setPendingId(teacher.id);
    try {
      await api(`/api/users/${teacher.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !teacher.active }),
      });
      await loadTeachers();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Nao foi possivel alterar o status.');
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Professores</p>
          <h1>Perfil do professor</h1>
        </div>
        <button type="button" onClick={() => void copyCadastroLink()}>
          Copiar link de cadastro
        </button>
      </header>

      {showForm && (
        <Modal title={editingId ? 'Editar professor' : 'Novo professor'} onClose={closeForm}>
          <form className="grid-form" onSubmit={handleSubmit}>
            <label>
              Nome
              <input
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="Nome do professor"
                autoFocus
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                placeholder="email@voxrio.xyz"
                disabled={Boolean(editingId)}
              />
            </label>
            <label>
              {editingId ? 'Nova senha (opcional)' : 'Senha'}
              <input
                type="password"
                value={form.password}
                onChange={(event) => updateField('password', event.target.value)}
                placeholder={editingId ? 'Deixe em branco para manter' : 'Min. 12 caracteres'}
                autoComplete="new-password"
              />
            </label>
            <label>
              Materia
              <select
                value={form.subjectId}
                onChange={(event) => updateField('subjectId', event.target.value)}
              >
                <option value="">Selecione a materia...</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Escola (opcional)
              <select
                value={form.unitId}
                onChange={(event) => updateField('unitId', event.target.value)}
              >
                <option value="">Sem escola fixa</option>
                {units
                  .filter((unit) => unit.active)
                  .map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="grid-form-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Criar professor'}
              </button>
              <button type="button" className="secondary-button" onClick={closeForm}>
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

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
            <table className="cards-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Materia</th>
                  <th>Escola</th>
                  <th>Status</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {visibleTeachers.length === 0 && (
                  <tr>
                    <td colSpan={5}>
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
                    <td data-label="Nome">{highlightMatch(teacher.name, search)}</td>
                    <td data-label="Materia">{teacher.subject?.name ?? '-'}</td>
                    <td data-label="Escola">{teacher.unit?.name ?? '-'}</td>
                    <td data-label="Status">
                      <span className="status-chip">
                        {teacher.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td data-label="Acoes">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            startEdit(teacher);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={pendingId === teacher.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleToggle(teacher);
                          }}
                        >
                          {pendingId === teacher.id
                            ? '...'
                            : teacher.active
                              ? 'Desativar'
                              : 'Ativar'}
                        </button>
                      </div>
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
