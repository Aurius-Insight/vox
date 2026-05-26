import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { LeadStage, StageConfig } from '../api/types';
import { Modal } from './Modal';
import { useToast } from './ToastProvider';

type ArchiveTarget = {
  stage: LeadStage;
  label: string;
  leadCount: number | null;
};

type EditState = {
  stage: LeadStage;
  label: string;
  color: string;
};

const EMPTY_EDIT: EditState = { stage: 'novo_lead', label: '', color: '' };

export function PipelineConfigPanel() {
  const [stages, setStages] = useState<StageConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [archiveMoveTo, setArchiveMoveTo] = useState<LeadStage | ''>('');
  const [archiveSaving, setArchiveSaving] = useState(false);
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
    setEdit({ stage: stage.stage, label: stage.label, color: stage.color ?? '' });
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!edit) return;
    setEditSaving(true);
    try {
      const body: Record<string, string | null> = { label: edit.label };
      body.color = edit.color.trim() === '' ? null : edit.color;
      await api<{ data: StageConfig }>(`/api/stages/${edit.stage}`, {
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

  async function startArchive(stage: StageConfig) {
    setArchiveSaving(true);
    try {
      // Tenta archive sem mover. Se a API responder destination_required,
      // abre o modal pedindo destino. Idempotente — etapas sem leads
      // arquivam direto.
      await api<{ data: StageConfig }>(`/api/stages/${stage.stage}/archive`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast.success(`"${stage.label}" arquivada.`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'destination_required') {
        setArchiveTarget({ stage: stage.stage, label: stage.label, leadCount: null });
        setArchiveMoveTo('');
      } else if (err instanceof ApiClientError) {
        toast.error(err.message);
      } else {
        toast.error('Nao foi possivel arquivar a etapa.');
      }
    } finally {
      setArchiveSaving(false);
    }
  }

  async function confirmArchive(event: FormEvent) {
    event.preventDefault();
    if (!archiveTarget || !archiveMoveTo) return;
    setArchiveSaving(true);
    try {
      const response = await api<{ data: StageConfig & { movedCount: number } }>(
        `/api/stages/${archiveTarget.stage}/archive`,
        {
          method: 'POST',
          body: JSON.stringify({ moveLeadsTo: archiveMoveTo }),
        },
      );
      const moved = response.data.movedCount ?? 0;
      toast.success(
        `"${archiveTarget.label}" arquivada. ${moved} ${moved === 1 ? 'lead movido' : 'leads movidos'}.`,
      );
      setArchiveTarget(null);
      setArchiveMoveTo('');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel arquivar a etapa.',
      );
    } finally {
      setArchiveSaving(false);
    }
  }

  async function restore(stage: StageConfig) {
    try {
      await api<{ data: StageConfig }>(`/api/stages/${stage.stage}/restore`, {
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
    const index = stages.findIndex((s) => s.stage === stage.stage);
    if (index === -1) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= stages.length) return;

    const next = stages.map((s, i) => {
      if (i === index) return { stage: stages[swapIndex].stage, order: s.order };
      if (i === swapIndex) return { stage: stages[index].stage, order: s.order };
      return { stage: s.stage, order: s.order };
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

  const destinos = archiveTarget
    ? stages.filter((s) => s.stage !== archiveTarget.stage && s.visible)
    : [];

  return (
    <section className="table-card">
      <div className="table-card-header">
        <strong>Pipeline de Vendas</strong>
        <span>Ordena, renomeia, define cor e oculta etapas do Kanban.</span>
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
              <th>Cor</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage, index) => (
              <tr key={stage.stage}>
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
                    <span className="status-chip" title="Etapa sistemica — nao pode ser arquivada">
                      Sistemica
                    </span>
                  )}
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
                        disabled={archiveSaving}
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
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

      {archiveTarget && (
        <Modal title={`Arquivar "${archiveTarget.label}"`} onClose={() => setArchiveTarget(null)}>
          <p className="muted-text">
            Esta etapa tem leads. Escolha para qual etapa esses leads devem ser movidos
            antes de arquivar.
          </p>
          <form className="grid-form" onSubmit={confirmArchive}>
            <label>
              Mover leads para
              <select
                value={archiveMoveTo}
                onChange={(event) => setArchiveMoveTo(event.target.value as LeadStage)}
                required
              >
                <option value="">Selecione uma etapa</option>
                {destinos.map((dest) => (
                  <option key={dest.stage} value={dest.stage}>
                    {dest.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid-form-actions">
              <button type="submit" disabled={archiveSaving || !archiveMoveTo}>
                {archiveSaving ? 'Aplicando...' : 'Mover leads e arquivar'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setArchiveTarget(null)}
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
