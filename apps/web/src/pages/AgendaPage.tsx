import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { AppUser, ClassSession, Subject, Unit } from '../api/types';
import { formatDateTime, isoToLocalInput, localInputToIso } from '../lib/format';
import { Modal } from '../components/Modal';
import { AgendaCalendar } from '../components/AgendaCalendar';
import { useToast } from '../components/ToastProvider';

type ClassForm = {
  isGuest: boolean;
  subjectId: string;
  teacherUserId: string;
  unitId: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
};

type EditForm = {
  capacity: string;
  startsAt: string;
  endsAt: string;
  teacherUserId: string;
};

const EMPTY_FORM: ClassForm = {
  isGuest: false,
  subjectId: '',
  teacherUserId: '',
  unitId: '',
  startsAt: '',
  endsAt: '',
  capacity: '12',
};

export function AgendaPage() {
  const [classes, setClasses] = useState<ClassSession[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<AppUser[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<ClassForm>(EMPTY_FORM);
  const [tab, setTab] = useState<'hoje' | 'proximas' | 'historico'>('hoje');
  const [viewMode, setViewMode] = useState<'calendario' | 'lista'>('calendario');
  const toast = useToast();

  // Divide as aulas em 3 baldes pela data (Hoje, Proximas, Historico).
  // Mesma logica da Presenca pra UX consistente.
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
    historico.reverse();
    return { hoje, proximas, historico };
  }, [classes]);

  const visibleClasses = buckets[tab];
  // setError/setInfo encaminham para o sistema de toasts (mensagem vazia = no-op).
  const setError = (message: string) => {
    if (message) toast.error(message);
  };
  const setInfo = (message: string) => {
    if (message) toast.success(message);
  };
  const [saving, setSaving] = useState(false);

  // Edicao inline: quando setado, esconde o "Nova aula" e mostra "Editar aula".
  const [editingClass, setEditingClass] = useState<ClassSession>();
  const [editForm, setEditForm] = useState<EditForm>({
    capacity: '',
    startsAt: '',
    endsAt: '',
    teacherUserId: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [classList, subjectList, teacherList, unitList] = await Promise.all([
        api<{ data: ClassSession[] }>('/api/classes'),
        api<{ data: Subject[] }>('/api/subjects'),
        api<{ data: AppUser[] }>('/api/users?role=professor'),
        api<{ data: Unit[] }>('/api/units'),
      ]);
      setClasses(classList.data);
      setSubjects(subjectList.data);
      setTeachers(teacherList.data);
      setUnits(unitList.data.filter((unit) => unit.active));
    } catch {
      setError('Nao foi possivel carregar a agenda.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField<K extends keyof ClassForm>(field: K, value: ClassForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateEdit<K extends keyof EditForm>(field: K, value: EditForm[K]) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  // Decisao da reuniao: a agenda e por materia, e o professor representa a
  // materia. Ao trocar a materia, o professor selecionado e limpo.
  function handleSubjectChange(subjectId: string) {
    setForm((current) => ({ ...current, subjectId, teacherUserId: '' }));
  }

  const availableTeachers = teachers.filter((teacher) => teacher.subjectId === form.subjectId);
  const editAvailableTeachers = teachers.filter(
    (teacher) => teacher.subjectId === editingClass?.subjectId,
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setInfo('');
    setSaving(true);

    try {
      await api<{ data: ClassSession }>('/api/classes', {
        method: 'POST',
        body: JSON.stringify({
          isGuest: form.isGuest,
          subjectId: form.isGuest ? undefined : form.subjectId,
          teacherUserId: form.isGuest ? undefined : form.teacherUserId,
          unitId: form.unitId,
          startsAt: localInputToIso(form.startsAt),
          endsAt: localInputToIso(form.endsAt),
          capacity: Number(form.capacity),
        }),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel criar a aula.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(classSession: ClassSession) {
    setError('');
    setInfo('');
    setShowForm(true);
    setEditingClass(classSession);
    setEditForm({
      capacity: String(classSession.capacity),
      startsAt: isoToLocalInput(classSession.startsAt),
      endsAt: isoToLocalInput(classSession.endsAt),
      teacherUserId: classSession.teacherUserId ?? '',
    });
  }

  function openNew() {
    setEditingClass(undefined);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingClass(undefined);
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingClass) return;
    setError('');
    setEditSaving(true);

    try {
      const body: Record<string, unknown> = {
        capacity: Number(editForm.capacity),
        startsAt: localInputToIso(editForm.startsAt),
        endsAt: localInputToIso(editForm.endsAt),
      };
      // Professor so faz parte do payload em aula regular E quando muda — evita
      // mandar string vazia em aula de convidado.
      if (!editingClass.isGuest && editForm.teacherUserId) {
        body.teacherUserId = editForm.teacherUserId;
      }
      await api<{ data: ClassSession }>(`/api/classes/${editingClass.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      closeForm();
      await load();
      setInfo('Aula atualizada.');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel salvar.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCancelClass(classSession: ClassSession) {
    const proceed = window.confirm(
      `Cancelar a aula "${classSession.displayName}" de ${formatDateTime(classSession.startsAt)}?\n` +
        'Todos os agendamentos ativos desta aula serao cancelados.',
    );
    if (!proceed) return;
    setError('');
    try {
      await api(`/api/classes/${classSession.id}`, { method: 'DELETE' });
      setInfo('Aula cancelada.');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel cancelar.');
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Coordenacao</p>
          <h1>Agenda operacional</h1>
        </div>
        <div className="row-actions">
          <button type="button" onClick={openNew}>
            Nova aula
          </button>
        </div>
      </header>

      {showForm && (
        <Modal
          title={editingClass ? `Editar aula — ${editingClass.displayName}` : 'Nova aula'}
          onClose={closeForm}
        >
          {editingClass ? (
            <>
              <p className="muted-text">
            Unidade ({editingClass.unitName ?? '-'}) e materia nao sao editaveis. Pra mudar,
            cancele esta aula e crie uma nova.
          </p>
          <form className="grid-form" onSubmit={handleSaveEdit}>
            <label>
              Capacidade
              <input
                type="number"
                min={1}
                max={200}
                value={editForm.capacity}
                onChange={(event) => updateEdit('capacity', event.target.value)}
                required
              />
            </label>
            <label>
              Inicio
              <input
                type="datetime-local"
                value={editForm.startsAt}
                onChange={(event) => updateEdit('startsAt', event.target.value)}
                required
              />
            </label>
            <label>
              Termino
              <input
                type="datetime-local"
                value={editForm.endsAt}
                onChange={(event) => updateEdit('endsAt', event.target.value)}
                required
              />
            </label>
            {!editingClass.isGuest && (
              <label>
                Professor
                <select
                  value={editForm.teacherUserId}
                  onChange={(event) => updateEdit('teacherUserId', event.target.value)}
                  required
                >
                  <option value="">Selecione</option>
                  {editAvailableTeachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid-form-actions">
              <div className="row-actions">
                <button type="submit" disabled={editSaving}>
                  {editSaving ? 'Salvando...' : 'Salvar alteracoes'}
                </button>
                <button type="button" className="secondary-button" onClick={closeForm}>
                  Cancelar edicao
                </button>
              </div>
            </div>
          </form>
            </>
          ) : (
            <form className="grid-form" onSubmit={handleSubmit}>
            <div className="role-options">
              <label>
                <input
                  type="checkbox"
                  checked={form.isGuest}
                  onChange={(event) => updateField('isGuest', event.target.checked)}
                />
                Aula com professor convidado
              </label>
            </div>

            {!form.isGuest && (
              <>
                <label>
                  Materia
                  <select
                    value={form.subjectId}
                    onChange={(event) => handleSubjectChange(event.target.value)}
                    required
                  >
                    <option value="">Selecione</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Professor
                  <select
                    value={form.teacherUserId}
                    onChange={(event) => updateField('teacherUserId', event.target.value)}
                    required
                    disabled={!form.subjectId}
                  >
                    <option value="">
                      {form.subjectId ? 'Selecione' : 'Escolha a materia primeiro'}
                    </option>
                    {availableTeachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            <label>
              Unidade
              <select
                value={form.unitId}
                onChange={(event) => updateField('unitId', event.target.value)}
                required
              >
                <option value="">Selecione</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Inicio
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(event) => updateField('startsAt', event.target.value)}
                required
              />
            </label>
            <label>
              Termino
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(event) => updateField('endsAt', event.target.value)}
                required
              />
            </label>
            <label>
              Capacidade
              <input
                type="number"
                min={1}
                max={200}
                value={form.capacity}
                onChange={(event) => updateField('capacity', event.target.value)}
                required
              />
            </label>
            <div className="grid-form-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Salvando...' : 'Criar aula'}
              </button>
            </div>
          </form>
          )}
        </Modal>
      )}

      <nav className="detail-tabs" aria-label="Modo de visualizacao">
        <button
          type="button"
          className={viewMode === 'calendario' ? 'is-active' : ''}
          onClick={() => setViewMode('calendario')}
        >
          Calendario
        </button>
        <button
          type="button"
          className={viewMode === 'lista' ? 'is-active' : ''}
          onClick={() => setViewMode('lista')}
        >
          Lista
        </button>
      </nav>

      {viewMode === 'calendario' && <AgendaCalendar classes={classes} onSelect={startEdit} />}

      {viewMode === 'lista' && (
        <>
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

      <section className="table-card">
        <table>
          <thead>
            <tr>
              <th>Aula</th>
              <th>Professor</th>
              <th>Unidade</th>
              <th>Inicio</th>
              <th>Ocupacao</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {visibleClasses.length === 0 && (
              <tr>
                <td colSpan={6}>
                  {classes.length === 0
                    ? 'Nenhuma aula cadastrada.'
                    : tab === 'hoje'
                      ? 'Nenhuma aula hoje.'
                      : tab === 'proximas'
                        ? 'Nenhuma aula futura agendada.'
                        : 'Nenhuma aula no historico.'}
                </td>
              </tr>
            )}
            {visibleClasses.map((classSession) => (
              <tr key={classSession.id}>
                <td>{classSession.displayName}</td>
                <td>{classSession.teacherName ?? '-'}</td>
                <td>{classSession.unitName ?? '-'}</td>
                <td>{formatDateTime(classSession.startsAt)}</td>
                <td>
                  {classSession.bookedCount}/{classSession.capacity}
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => startEdit(classSession)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="secondary-button danger-button"
                      onClick={() => void handleCancelClass(classSession)}
                    >
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
        </>
      )}
    </main>
  );
}
