import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { AppUser, ClassSession, Subject, Unit } from '../api/types';
import { formatDateTime, isoToLocalInput, localInputToIso } from '../lib/format';

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
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
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
    setEditingClass(classSession);
    setEditForm({
      capacity: String(classSession.capacity),
      startsAt: isoToLocalInput(classSession.startsAt),
      endsAt: isoToLocalInput(classSession.endsAt),
      teacherUserId: classSession.teacherUserId ?? '',
    });
  }

  function cancelEdit() {
    setEditingClass(undefined);
    setError('');
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
      cancelEdit();
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
      </header>

      {error && <p className="form-error">{error}</p>}
      {info && <p className="form-info">{info}</p>}

      {editingClass ? (
        <section className="form-card">
          <h2>Editar aula — {editingClass.displayName}</h2>
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
                <button type="button" className="secondary-button" onClick={cancelEdit}>
                  Cancelar edicao
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : (
        <section className="form-card">
          <h2>Nova aula</h2>
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
        </section>
      )}

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
            {classes.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhuma aula cadastrada.</td>
              </tr>
            )}
            {classes.map((classSession) => (
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
    </main>
  );
}
