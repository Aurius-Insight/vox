import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { Unit } from '../api/types';
import { useToast } from '../components/ToastProvider';

type UnitForm = {
  name: string;
  address: string;
  capacity: string;
};

const EMPTY_FORM: UnitForm = {
  name: '',
  address: '',
  capacity: '0',
};

export function UnidadesPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<UnitForm>(EMPTY_FORM);
  const [editingUnitId, setEditingUnitId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [pendingUnitId, setPendingUnitId] = useState<string>();

  const load = useCallback(async () => {
    try {
      const response = await api<{ data: Unit[] }>('/api/units');
      setUnits(response.data);
    } catch {
      toast.error('Nao foi possivel carregar as unidades.');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField(field: keyof UnitForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEdit(unit: Unit) {
    setEditingUnitId(unit.id);
    setForm({
      name: unit.name,
      address: unit.address,
      capacity: String(unit.capacity),
    });
  }

  function cancelEdit() {
    setEditingUnitId(undefined);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    const payload = {
      name: form.name,
      address: form.address,
      capacity: Number(form.capacity),
    };

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
      cancelEdit();
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel salvar a unidade.',
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
        err instanceof ApiClientError ? err.message : 'Nao foi possivel atualizar a unidade.',
      );
    } finally {
      setPendingUnitId(undefined);
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Unidades</p>
          <h1>Gestao de unidades</h1>
        </div>
      </header>

      <section className="form-card">
        <h2>{editingUnitId ? 'Editar unidade' : 'Nova unidade'}</h2>
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
            Endereco
            <input
              value={form.address}
              onChange={(event) => updateField('address', event.target.value)}
              required
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
              required
            />
          </label>
          <div className="grid-form-actions">
            <div className="row-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Salvando...' : editingUnitId ? 'Salvar alteracoes' : 'Criar unidade'}
              </button>
              {editingUnitId && (
                <button type="button" className="secondary-button" onClick={cancelEdit}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </form>
      </section>

      <section className="table-card">
        <table>
          <thead>
            <tr>
              <th>Unidade</th>
              <th>Endereco</th>
              <th>Capacidade</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {units.length === 0 && (
              <tr>
                <td colSpan={5}>Nenhuma unidade cadastrada.</td>
              </tr>
            )}
            {units.map((unit) => (
              <tr key={unit.id}>
                <td>{unit.name}</td>
                <td>{unit.address}</td>
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
