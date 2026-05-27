import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { Subject } from '../api/types';
import { Modal } from './Modal';
import { useToast } from './ToastProvider';

type SubjectForm = {
  name: string;
  description: string;
};

const EMPTY_FORM: SubjectForm = { name: '', description: '' };

export function SubjectsConfigPanel() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [form, setForm] = useState<SubjectForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string>();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      // ?includeArchived=1 traz tambem as inativas pra editar/reativar.
      const response = await api<{ data: Subject[] }>('/api/subjects?includeArchived=1');
      setSubjects(response.data);
    } catch {
      toast.error('Nao foi possivel carregar as materias.');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField(field: keyof SubjectForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEdit(subject: Subject) {
    setShowForm(true);
    setEditingId(subject.id);
    setForm({ name: subject.name, description: subject.description ?? '' });
  }

  function openNew() {
    setEditingId(undefined);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(undefined);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
    };
    try {
      if (editingId) {
        await api<{ data: Subject }>(`/api/subjects/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api<{ data: Subject }>('/api/subjects', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      closeForm();
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel salvar a materia.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(subject: Subject) {
    setPendingId(subject.id);
    try {
      await api<{ data: Subject }>(`/api/subjects/${subject.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !subject.active }),
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel alterar a materia.',
      );
    } finally {
      setPendingId(undefined);
    }
  }

  async function handleDelete(subject: Subject) {
    const proceed = window.confirm(
      `Excluir definitivamente "${subject.name}"? Se houver professor ou aula vinculada, a exclusao e bloqueada — nesse caso, arquive.`,
    );
    if (!proceed) return;
    setPendingId(subject.id);
    try {
      await api(`/api/subjects/${subject.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel excluir a materia.',
      );
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <section className="table-card">
      <header className="table-card-header">
        <div>
          <strong>Materias</strong>
          <span className="muted-text">Disciplinas oferecidas pela escola.</span>
        </div>
        <button type="button" onClick={openNew}>
          Nova materia
        </button>
      </header>

      {showForm && (
        <Modal title={editingId ? 'Editar materia' : 'Nova materia'} onClose={closeForm}>
          <form className="grid-form" onSubmit={handleSubmit}>
            <label>
              Nome
              <input
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                required
                minLength={2}
                maxLength={120}
              />
            </label>
            <label>
              Descricao (opcional)
              <textarea
                value={form.description}
                onChange={(event) => updateField('description', event.target.value)}
                rows={6}
                maxLength={2000}
                placeholder="Texto institucional sobre a disciplina."
              />
            </label>
            <div className="grid-form-actions">
              <div className="row-actions">
                <button type="submit" disabled={saving}>
                  {saving ? 'Salvando...' : editingId ? 'Salvar alteracoes' : 'Criar materia'}
                </button>
                <button type="button" className="secondary-button" onClick={closeForm}>
                  Cancelar
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      <table>
        <thead>
          <tr>
            <th>Materia</th>
            <th>Descricao</th>
            <th>Status</th>
            <th>Acoes</th>
          </tr>
        </thead>
        <tbody>
          {subjects.length === 0 && (
            <tr>
              <td colSpan={4}>Nenhuma materia cadastrada.</td>
            </tr>
          )}
          {subjects.map((subject) => (
            <tr key={subject.id}>
              <td>{subject.name}</td>
              <td className="muted-text">
                {subject.description
                  ? subject.description.length > 90
                    ? `${subject.description.slice(0, 90)}...`
                    : subject.description
                  : '—'}
              </td>
              <td>{subject.active === false ? 'arquivada' : 'ativa'}</td>
              <td>
                <div className="row-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => startEdit(subject)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pendingId === subject.id}
                    onClick={() => void handleToggle(subject)}
                  >
                    {pendingId === subject.id
                      ? 'Salvando...'
                      : subject.active === false
                        ? 'Reativar'
                        : 'Arquivar'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pendingId === subject.id}
                    onClick={() => void handleDelete(subject)}
                  >
                    Excluir
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
