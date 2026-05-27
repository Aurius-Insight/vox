import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { Unit } from '../api/types';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastProvider';

type UnitForm = {
  name: string;
  address: string;
  phone: string;
  capacity: string;
};

const EMPTY_FORM: UnitForm = {
  name: '',
  address: '',
  phone: '',
  capacity: '0',
};

export function UnidadesPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<UnitForm>(EMPTY_FORM);
  const [editingUnitId, setEditingUnitId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [pendingUnitId, setPendingUnitId] = useState<string>();
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api<{ data: Unit[] }>('/api/units');
      setUnits(response.data);
    } catch {
      toast.error('Nao foi possivel carregar as escolas.');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField(field: keyof UnitForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEdit(unit: Unit) {
    setShowForm(true);
    setEditingUnitId(unit.id);
    setForm({
      name: unit.name,
      address: unit.address,
      phone: unit.phone ?? '',
      capacity: String(unit.capacity),
    });
  }

  function cancelEdit() {
    setEditingUnitId(undefined);
    setForm(EMPTY_FORM);
  }

  function openNew() {
    cancelEdit();
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    cancelEdit();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    // address/phone vazios entram como string vazia/null (campo opcional).
    const payload: Record<string, unknown> = {
      name: form.name,
      address: form.address,
      capacity: Number(form.capacity) || 0,
    };
    payload.phone = form.phone.trim() === '' ? null : form.phone.trim();

    try {
      if (editingUnitId) {
        await api<{ data: Unit }>(`/api/units/${editingUnitId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api<{ data: Unit }>('/api/units', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      closeForm();
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel salvar a escola.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(unit: Unit) {
    setPendingUnitId(unit.id);

    try {
      const response = await api<{ data: Unit }>(`/api/units/${unit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !unit.active }),
      });
      setUnits((current) =>
        current.map((item) => (item.id === response.data.id ? response.data : item)),
      );
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel atualizar a escola.',
      );
    } finally {
      setPendingUnitId(undefined);
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Escolas</p>
          <h1>Gestao de escolas</h1>
        </div>
        <div className="row-actions">
          <button type="button" onClick={openNew}>
            Nova escola
          </button>
        </div>
      </header>

      {showForm && (
        <Modal
          title={editingUnitId ? 'Editar escola' : 'Nova escola'}
          onClose={closeForm}
        >
          <form className="grid-form" onSubmit={handleSubmit}>
          <label>
            Nome
            <input
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              required
            />
          </label>
          <label>
            Endereco (opcional)
            <input
              value={form.address}
              onChange={(event) => updateField('address', event.target.value)}
              placeholder="Rua, numero, sala, bairro"
            />
          </label>
          <label>
            Telefone / WhatsApp (opcional)
            <input
              value={form.phone}
              onChange={(event) => updateField('phone', event.target.value)}
              placeholder="21 99999-9999"
            />
          </label>
          <label>
            Capacidade
            <input
              type="number"
              min={0}
              max={10000}
              value={form.capacity}
              onChange={(event) => updateField('capacity', event.target.value)}
            />
          </label>
          <div className="grid-form-actions">
            <div className="row-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Salvando...' : editingUnitId ? 'Salvar alteracoes' : 'Criar escola'}
              </button>
              <button type="button" className="secondary-button" onClick={closeForm}>
                Cancelar
              </button>
            </div>
          </div>
        </form>
        </Modal>
      )}

      <section className="table-card">
        <table>
          <thead>
            <tr>
              <th>Escola</th>
              <th>Endereco</th>
              <th>Telefone</th>
              <th>Capacidade</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {units.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhuma escola cadastrada.</td>
              </tr>
            )}
            {units.map((unit) => (
              <tr key={unit.id}>
                <td>{unit.name}</td>
                <td>{unit.address || <span className="muted-text">—</span>}</td>
                <td>{unit.phone || <span className="muted-text">—</span>}</td>
                <td>{unit.capacity}</td>
                <td>{unit.active ? 'ativa' : 'inativa'}</td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => startEdit(unit)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={pendingUnitId === unit.id}
                      onClick={() => void handleToggle(unit)}
                    >
                      {pendingUnitId === unit.id
                        ? 'Salvando...'
                        : unit.active
                          ? 'Desativar'
                          : 'Ativar'}
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
