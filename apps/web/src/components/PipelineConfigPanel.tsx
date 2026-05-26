import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { LeadStageKind, StageConfig } from '../api/types';
import { Modal } from './Modal';
import { useToast } from './ToastProvider';

type DestinationDialog = {
  action: 'archive' | 'delete';
  target: StageConfig;
};

type EditState = {
  slug: string;
  label: string;
  color: string;
};

type CreateState = {
  label: string;
  color: string;
  kind: LeadStageKind;
};

const EMPTY_CREATE: CreateState = { label: '', color: '', kind: 'active' };

export function PipelineConfigPanel() {
  const [stages, setStages] = useState<StageConfig[]>([]);
  const [loading, setLoading] = useState(false);

  const [edit, setEdit] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [create, setCreate] = useState<CreateState | null>(null);
  const [createSaving, setCreateSaving] = useState(false);

  const [destDialog, setDestDialog] = useState<DestinationDialog | null>(null);
  const [destMoveTo, setDestMoveTo] = useState<string>('');
  const [destSaving, setDestSaving] = useState(false);

  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api<{ data: StageConfig[] }>('/api/stages');
      setStages(response.data);
    } catch {
      toast.error('Nao foi possivel carregar a configuracao do pipeline.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(stage: StageConfig) {
    setEdit({ slug: stage.slug, label: stage.label, color: stage.color ?? '' });
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!edit) return;
    setEditSaving(true);
    try {
      const body: Record<string, string | null> = { label: edit.label };
      body.color = edit.color.trim() === '' ? null : edit.color;
      await api<{ data: StageConfig }>(`/api/stages/${edit.slug}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      toast.success('Etapa atualizada.');
      setEdit(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel salvar a etapa.',
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!create) return;
    setCreateSaving(true);
    try {
      const body: Record<string, string | null> = {
        label: create.label,
        kind: create.kind,
      };
      if (create.color.trim() !== '') body.color = create.color;
      await api<{ data: StageConfig }>('/api/stages', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success(`"${create.label}" criada.`);
      setCreate(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel criar a etapa.',
      );
    } finally {
      setCreateSaving(false);
    }
  }

  async function startArchive(stage: StageConfig) {
    setDestSaving(true);
    try {
      // Tenta archive sem mover. Se a API responder destination_required,
      // abre o modal pedindo destino.
      await api<{ data: StageConfig }>(`/api/stages/${stage.slug}/archive`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast.success(`"${stage.label}" arquivada.`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'destination_required') {
        setDestDialog({ action: 'archive', target: stage });
        setDestMoveTo('');
      } else if (err instanceof ApiClientError) {
        toast.error(err.message);
      } else {
        toast.error('Nao foi possivel arquivar a etapa.');
      }
    } finally {
      setDestSaving(false);
    }
  }

  async function startDelete(stage: StageConfig) {
    if (!window.confirm(`Excluir definitivamente "${stage.label}"? Esta acao nao pode ser desfeita.`)) {
      return;
    }
    setDestSaving(true);
    try {
      await api<{ data: { movedCount: number } }>(`/api/stages/${stage.slug}`, {
        method: 'DELETE',
      });
      toast.success(`"${stage.label}" excluida.`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'destination_required') {
        setDestDialog({ action: 'delete', target: stage });
        setDestMoveTo('');
      } else if (err instanceof ApiClientError) {
        toast.error(err.message);
      } else {
        toast.error('Nao foi possivel excluir a etapa.');
      }
    } finally {
      setDestSaving(false);
    }
  }

  async function confirmDestination(event: FormEvent) {
    event.preventDefault();
    if (!destDialog || !destMoveTo) return;
    setDestSaving(true);
    try {
      const path = `/api/stages/${destDialog.target.slug}${destDialog.action === 'archive' ? '/archive' : ''}`;
      const method = destDialog.action === 'archive' ? 'POST' : 'DELETE';
      const response = await api<{ data: { movedCount?: number } }>(path, {
        method,
        body: JSON.stringify({ moveLeadsTo: destMoveTo }),
      });
      const moved = response.data.movedCount ?? 0;
      const verb = destDialog.action === 'archive' ? 'arquivada' : 'excluida';
      toast.success(
        `"${destDialog.target.label}" ${verb}. ${moved} ${moved === 1 ? 'lead movido' : 'leads movidos'}.`,
      );
      setDestDialog(null);
      setDestMoveTo('');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : `Nao foi possivel ${destDialog.action === 'archive' ? 'arquivar' : 'excluir'}.`,
      );
    } finally {
      setDestSaving(false);
    }
  }

  async function restore(stage: StageConfig) {
    try {
      await api<{ data: StageConfig }>(`/api/stages/${stage.slug}/restore`, {
        method: 'POST',
      });
      toast.success(`"${stage.label}" reativada.`);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel restaurar a etapa.',
      );
    }
  }

  async function move(stage: StageConfig, direction: 'up' | 'down') {
    const index = stages.findIndex((s) => s.id === stage.id);
    if (index === -1) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= stages.length) return;

    const next = stages.map((s, i) => {
      if (i === index) return { id: stages[swapIndex].id, order: s.order };
      if (i === swapIndex) return { id: stages[index].id, order: s.order };
      return { id: s.id, order: s.order };
    });

    try {
      await api<{ data: StageConfig[] }>('/api/stages/reorder', {
        method: 'POST',
        body: JSON.stringify({ order: next }),
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel reordenar.',
      );
    }
  }

  const destinos = destDialog
    ? stages.filter((s) => s.id !== destDialog.target.id && !s.archived)
    : [];

  const KIND_LABELS: Record<LeadStageKind, string> = {
    active: 'Em andamento',
    won: 'Sucesso (conversao)',
    lost: 'Perdido',
  };

  return (
    <section className="table-card">
      <div className="table-card-header">
        <strong>Pipeline de Vendas</strong>
        <span>Cria, ordena, renomeia, arquiva e exclui etapas do Kanban.</span>
      </div>

      <div className="row-actions" style={{ padding: '12px 0' }}>
        <button type="button" onClick={() => setCreate(EMPTY_CREATE)}>
          Nova etapa
        </button>
      </div>

      {loading && stages.length === 0 && (
        <p className="muted-text">Carregando etapas...</p>
      )}

      {stages.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Ordem</th>
              <th>Etapa</th>
              <th>Tipo</th>
              <th>Cor</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage, index) => (
              <tr key={stage.id}>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void move(stage, 'up')}
                      disabled={index === 0}
                      aria-label={`Mover ${stage.label} para cima`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void move(stage, 'down')}
                      disabled={index === stages.length - 1}
                      aria-label={`Mover ${stage.label} para baixo`}
                    >
                      ↓
                    </button>
                    <span className="muted-text">{stage.order}</span>
                  </div>
                </td>
                <td>
                  <strong>{stage.label}</strong>
                  {stage.systemic && (
                    <span className="status-chip" title="Etapa sistemica — nao pode ser arquivada ou excluida">
                      Sistemica
                    </span>
                  )}
                </td>
                <td>
                  <span className="muted-text">{KIND_LABELS[stage.kind]}</span>
                </td>
                <td>
                  {stage.color ? (
                    <span
                      className="stage-color-swatch"
                      style={{ background: stage.color }}
                      aria-label={`Cor ${stage.color}`}
                    />
                  ) : (
                    <span className="muted-text">—</span>
                  )}
                </td>
                <td>
                  <span className="status-chip">
                    {stage.visible ? 'Ativa' : 'Arquivada'}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openEdit(stage)}
                    >
                      Editar
                    </button>
                    {stage.visible && !stage.systemic && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void startArchive(stage)}
                        disabled={destSaving}
                      >
                        Arquivar
                      </button>
                    )}
                    {!stage.visible && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void restore(stage)}
                      >
                        Restaurar
                      </button>
                    )}
                    {!stage.systemic && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void startDelete(stage)}
                        disabled={destSaving}
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {create && (
        <Modal title="Nova etapa" onClose={() => setCreate(null)}>
          <p className="muted-text">
            Crie uma etapa custom no pipeline. Etapas custom nao recebem leads
            automaticos do BotConversa — operador move via Kanban.
          </p>
          <form className="grid-form" onSubmit={handleCreate}>
            <label>
              Nome exibido
              <input
                value={create.label}
                onChange={(event) =>
                  setCreate((current) => current && { ...current, label: event.target.value })
                }
                required
                maxLength={80}
              />
            </label>
            <label>
              Tipo
              <select
                value={create.kind}
                onChange={(event) =>
                  setCreate(
                    (current) =>
                      current && { ...current, kind: event.target.value as LeadStageKind },
                  )
                }
              >
                <option value="active">Em andamento (intermediaria)</option>
                <option value="won">Sucesso (conversao) — entra na taxa de conversao</option>
                <option value="lost">Perdido — saiu do funil</option>
              </select>
            </label>
            <label>
              Cor (hex, opcional)
              <input
                value={create.color}
                onChange={(event) =>
                  setCreate((current) => current && { ...current, color: event.target.value })
                }
                placeholder="#f97316"
                pattern="^#[0-9a-fA-F]{6}$"
              />
            </label>
            <div className="grid-form-actions">
              <button type="submit" disabled={createSaving}>
                {createSaving ? 'Criando...' : 'Criar etapa'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCreate(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {edit && (
        <Modal title="Editar etapa" onClose={() => setEdit(null)}>
          <form className="grid-form" onSubmit={handleSaveEdit}>
            <label>
              Nome exibido
              <input
                value={edit.label}
                onChange={(event) =>
                  setEdit((current) => current && { ...current, label: event.target.value })
                }
                required
                maxLength={80}
              />
            </label>
            <label>
              Cor (hex, ex: #f97316)
              <input
                value={edit.color}
                onChange={(event) =>
                  setEdit((current) => current && { ...current, color: event.target.value })
                }
                placeholder="#f97316"
                pattern="^#[0-9a-fA-F]{6}$"
              />
            </label>
            <div className="grid-form-actions">
              <button type="submit" disabled={editSaving}>
                {editSaving ? 'Salvando...' : 'Salvar'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEdit(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {destDialog && (
        <Modal
          title={`${destDialog.action === 'archive' ? 'Arquivar' : 'Excluir'} "${destDialog.target.label}"`}
          onClose={() => setDestDialog(null)}
        >
          <p className="muted-text">
            Esta etapa tem leads. Escolha para qual etapa esses leads devem ser
            movidos antes de {destDialog.action === 'archive' ? 'arquivar' : 'excluir'}.
          </p>
          <form className="grid-form" onSubmit={confirmDestination}>
            <label>
              Mover leads para
              <select
                value={destMoveTo}
                onChange={(event) => setDestMoveTo(event.target.value)}
                required
              >
                <option value="">Selecione uma etapa</option>
                {destinos.map((dest) => (
                  <option key={dest.id} value={dest.slug}>
                    {dest.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid-form-actions">
              <button type="submit" disabled={destSaving || !destMoveTo}>
                {destSaving
                  ? 'Aplicando...'
                  : `Mover leads e ${destDialog.action === 'archive' ? 'arquivar' : 'excluir'}`}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDestDialog(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
