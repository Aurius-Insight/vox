import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ApiClientError, api } from '../api/client';
import { formatAge, formatDate, whatsappLink } from '../lib/format';
import { Modal } from '../components/Modal';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  type Lead,
  type LeadStage,
  type Package,
  type StageConfig,
  type Unit,
} from '../api/types';

type LeadForm = {
  name: string;
  whatsapp: string;
  unitInterest: string;
  campaign: string;
  source: string;
};

type ConvertForm = {
  type: 'matriculado' | 'experimental';
  cpf: string;
  unitId: string;
  packageId: string;
};

type ConvertResponse = {
  data: {
    student: {
      id: string;
      name: string;
      enrollmentCode: string;
      packageName: string | null;
      type: 'matriculado' | 'experimental';
    };
    lead: Lead;
  };
};

const EMPTY_FORM: LeadForm = {
  name: '',
  whatsapp: '',
  unitInterest: '',
  campaign: '',
  source: '',
};

const EMPTY_CONVERT: ConvertForm = {
  type: 'matriculado',
  cpf: '',
  unitId: '',
  packageId: '',
};

// Etapas terminais nao aceitam mais conversao (matriculado ja foi; perdido
// virou nao-oportunidade). Para o resto, o card mostra o botao Converter.
// Terminais por slug — etapas custom com kind 'won' ou 'lost' tambem
// deveriam entrar aqui, mas o front so conhece os sistemicos por agora.
// (TODO: usar StageConfig.kind quando precisarmos da granularidade.)
const TERMINAL_STAGES: ReadonlySet<string> = new Set(['matriculado', 'perdido']);

const NAO_INFORMADO = 'Nao informado';

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const toast = useToast();

  const [convertingLead, setConvertingLead] = useState<Lead>();
  const [convertForm, setConvertForm] = useState<ConvertForm>(EMPTY_CONVERT);
  const [convertSaving, setConvertSaving] = useState(false);

  // Estado do modal "Student manda": ao tentar arrastar um lead que ja virou
  // aluno matriculado, abrimos um aviso porque a etapa do card e controlada
  // pelo cadastro, nao mais pelo Kanban. Operador pode insistir, mas sabendo.
  const [pendingMove, setPendingMove] = useState<{ leadId: string; from: string; to: string }>();

  // Config dinamica das etapas (ordem, labels, cor, visibilidade).
  // Vem do servidor; fallback pros defaults estaticos enquanto carrega.
  const [stageConfigs, setStageConfigs] = useState<StageConfig[]>([]);

  // Filtros do Kanban — controlam o que vai pra API.
  const [unitFilter, setUnitFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Click "sem mover" nao deve disparar drag — protege o botao "Converter".
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Debounce simples na busca: 300ms apos o ultimo keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ pageSize: '500' });
      if (unitFilter) params.set('unit', unitFilter);
      if (search) params.set('search', search);
      const [leadList, packageList, unitList, stagesList] = await Promise.all([
        api<{ data: Lead[] }>(`/api/leads?${params}`),
        api<{ data: Package[] }>('/api/packages'),
        api<{ data: Unit[] }>('/api/units'),
        api<{ data: StageConfig[] }>('/api/stages'),
      ]);
      setLeads(leadList.data);
      setPackages(packageList.data.filter((item) => item.active));
      setUnits(unitList.data.filter((item) => item.active));
      setStageConfigs(stagesList.data);
    } catch {
      toast.error('Nao foi possivel carregar os leads.');
    } finally {
      setLoading(false);
    }
  }, [unitFilter, search, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Modal de conversao: fecha no Esc e trava o scroll do fundo enquanto aberto.
  useEffect(() => {
    if (!convertingLead) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setConvertingLead(undefined);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [convertingLead]);

  // Agrupa por slug de etapa (string dinamica). Cada slug aponta pra lista
  // de leads. Etapas sem leads aparecem como `[]` se referenciadas.
  const leadsByStage = useMemo(() => {
    const grouped: Record<string, Lead[]> = {};
    for (const lead of leads) {
      const list = grouped[lead.stage] ?? [];
      list.push(lead);
      grouped[lead.stage] = list;
    }
    return grouped;
  }, [leads]);

  // Lista de etapas visiveis no Kanban (vinda do servidor, na ordem
  // definida pelo diretor). `slug` virou identificador estavel (substitui
  // o antigo `stage` enum). Etapas arquivadas saem do quadro mas leads
  // continuam no DB; aparecem se diretor restaurar.
  const visibleStages = useMemo(() => {
    if (stageConfigs.length === 0) {
      return LEAD_STAGES.map((slug) => ({
        slug: slug as string,
        label: LEAD_STAGE_LABELS[slug as LeadStage],
        color: null as string | null,
      }));
    }
    return stageConfigs
      .filter((s) => s.visible)
      .map((s) => ({ slug: s.slug, label: s.label, color: s.color }));
  }, [stageConfigs]);

  const stageLabel = (slug: string): string => {
    const config = stageConfigs.find((s) => s.slug === slug);
    if (config) return config.label;
    return LEAD_STAGE_LABELS[slug as LeadStage] ?? slug;
  };

  function updateField(field: keyof LeadForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateConvertField(field: keyof ConvertForm, value: string) {
    setConvertForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    try {
      await api<{ data: Lead }>('/api/leads', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          whatsapp: form.whatsapp,
          unitInterest: form.unitInterest,
          campaign: form.campaign || undefined,
          source: form.source,
        }),
      });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel criar o lead.',
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * Drag-and-drop: ao soltar o card numa coluna diferente, faz update
   * otimista (move ja na UI) e dispara o PATCH. Em caso de erro, reverte.
   *
   * Quando o lead ja virou aluno matriculado, a regra Student manda diz
   * que a etapa e controlada pelo cadastro — entao abrimos um modal de
   * confirmacao antes de chamar a API. Operador pode confirmar (segue
   * normalmente) ou cancelar (volta o card pra coluna anterior).
   */
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const leadId = String(active.id);
    const newStage = over.id as LeadStage;
    const lead = leads.find((item) => item.id === leadId);
    if (!lead || lead.stage === newStage) return;

    if (lead.studentType === 'matriculado') {
      setPendingMove({ leadId, from: lead.stage, to: newStage });
      return;
    }

    await applyStageMove(leadId, lead.stage, newStage);
  }

  async function applyStageMove(leadId: string, previousStage: string, newStage: string) {
    setLeads((current) =>
      current.map((item) => (item.id === leadId ? { ...item, stage: newStage } : item)),
    );

    try {
      const response = await api<{ data: Lead }>(`/api/leads/${leadId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: newStage }),
      });
      setLeads((current) =>
        current.map((item) => (item.id === leadId ? response.data : item)),
      );
    } catch (err) {
      setLeads((current) =>
        current.map((item) =>
          item.id === leadId ? { ...item, stage: previousStage } : item,
        ),
      );
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel mover o lead.',
      );
    }
  }

  async function confirmPendingMove() {
    if (!pendingMove) return;
    const { leadId, from, to } = pendingMove;
    setPendingMove(undefined);
    await applyStageMove(leadId, from, to);
  }

  function cancelPendingMove() {
    setPendingMove(undefined);
  }

  function startConvert(lead: Lead) {
    setConvertingLead(lead);
    setConvertForm(EMPTY_CONVERT);
  }

  function cancelConvert() {
    setConvertingLead(undefined);
  }

  async function handleConvert(event: FormEvent) {
    event.preventDefault();
    if (!convertingLead) return;
    setConvertSaving(true);

    try {
      const body: Record<string, string> = {
        type: convertForm.type,
        unitId: convertForm.unitId,
      };
      if (convertForm.cpf) body.cpf = convertForm.cpf;
      if (convertForm.type === 'matriculado' && convertForm.packageId) {
        body.packageId = convertForm.packageId;
      }
      const response = await api<ConvertResponse>(`/api/leads/${convertingLead.id}/convert`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const { name, enrollmentCode, packageName, type } = response.data.student;
      toast.success(
        type === 'matriculado'
          ? `${name} matriculado. Matricula ${enrollmentCode} - ${packageName}.`
          : `${name} virou aluno experimental. Matricula ${enrollmentCode}.`,
      );
      setConvertingLead(undefined);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel converter o lead.',
      );
    } finally {
      setConvertSaving(false);
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Vendas</p>
          <h1>Pipeline de atendimento</h1>
        </div>
        <div className="row-actions">
          <button type="button" onClick={() => setShowCreate(true)}>
            Novo lead
          </button>
        </div>
      </header>

      {pendingMove && (
        <Modal title="Aluno matriculado — mover assim mesmo?" onClose={cancelPendingMove}>
          <p className="muted-text">
            Esse lead ja virou aluno matriculado. A etapa do card agora e
            controlada pelo cadastro do aluno (Student manda), entao a sincronia
            com o BotConversa nao mexe mais aqui.
          </p>
          <p className="muted-text">
            Mover de <strong>{stageLabel(pendingMove.from)}</strong> para{' '}
            <strong>{stageLabel(pendingMove.to)}</strong>?
          </p>
          <div className="grid-form-actions">
            <div className="row-actions">
              <button type="button" onClick={() => void confirmPendingMove()}>
                Mover assim mesmo
              </button>
              <button type="button" className="secondary-button" onClick={cancelPendingMove}>
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {convertingLead && (
        <div className="modal-overlay" onClick={cancelConvert}>
          <section
            className="form-card modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Converter em aluno: {convertingLead.name}</h2>
            <p className="muted-text">
              {convertForm.type === 'matriculado'
                ? 'O saldo de aulas vem da quantidade do pacote. CPF e opcional — preencha quando tiver.'
                : 'Cria o aluno experimental (sem pacote). O lead vai pra "experimental_agendada".'}
            </p>
            <form className="grid-form" onSubmit={handleConvert}>
              <label>
                Tipo
                <select
                  value={convertForm.type}
                  onChange={(event) =>
                    updateConvertField('type', event.target.value as ConvertForm['type'])
                  }
                  required
                >
                  <option value="matriculado">Matriculado</option>
                  <option value="experimental">Experimental</option>
                </select>
              </label>
              <label>
                CPF (opcional)
                <input
                  value={convertForm.cpf}
                  onChange={(event) => updateConvertField('cpf', event.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label>
                Unidade
                <select
                  value={convertForm.unitId}
                  onChange={(event) => updateConvertField('unitId', event.target.value)}
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
              {convertForm.type === 'matriculado' && (
                <label>
                  Pacote
                  <select
                    value={convertForm.packageId}
                    onChange={(event) => updateConvertField('packageId', event.target.value)}
                    required
                  >
                    <option value="">Selecione</option>
                    {packages.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.classCount} aulas)
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid-form-actions">
                <div className="row-actions">
                  <button type="submit" disabled={convertSaving}>
                    {convertSaving
                      ? 'Convertendo...'
                      : convertForm.type === 'matriculado'
                        ? 'Matricular aluno'
                        : 'Cadastrar como experimental'}
                  </button>
                  <button type="button" className="secondary-button" onClick={cancelConvert}>
                    Cancelar
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      )}

      {showCreate && (
        <Modal title="Novo lead" onClose={() => setShowCreate(false)}>
          <form className="grid-form" onSubmit={handleCreate}>
          <label>
            Nome
            <input
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              required
            />
          </label>
          <label>
            WhatsApp
            <input
              value={form.whatsapp}
              onChange={(event) => updateField('whatsapp', event.target.value)}
              required
            />
          </label>
          <label>
            Unidade de interesse
            <input
              value={form.unitInterest}
              onChange={(event) => updateField('unitInterest', event.target.value)}
              required
            />
          </label>
          <label>
            Campanha
            <input
              value={form.campaign}
              onChange={(event) => updateField('campaign', event.target.value)}
            />
          </label>
          <label>
            Origem
            <input
              value={form.source}
              onChange={(event) => updateField('source', event.target.value)}
              required
            />
          </label>
          <div className="grid-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Salvando...' : 'Criar lead'}
            </button>
          </div>
        </form>
        </Modal>
      )}

      <UnitTabs units={units} active={unitFilter} onSelect={setUnitFilter} />

      <section className="filters-bar">
        <label className="filter-search">
          <span>Buscar</span>
          <input
            type="search"
            placeholder="Nome, telefone, campanha…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        <span className="filters-count">
          {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
          {(unitFilter || search) && (
            <button
              type="button"
              className="filters-clear"
              onClick={() => {
                setUnitFilter('');
                setSearchInput('');
              }}
            >
              limpar
            </button>
          )}
        </span>
      </section>

      {loading ? (
        <section className="kanban-board" aria-hidden="true">
          {visibleStages.map((cfg) => (
            <div key={cfg.slug} className="kanban-column">
              <header className="kanban-column-header">
                <Skeleton width="100px" height="0.85rem" />
              </header>
              <div className="kanban-column-body">
                <Skeleton height="96px" radius="10px" />
                <Skeleton height="96px" radius="10px" />
                <Skeleton height="96px" radius="10px" />
              </div>
            </div>
          ))}
        </section>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <section className="kanban-board" aria-label="Pipeline de leads">
            {visibleStages.map((cfg) => (
              <KanbanColumn
                key={cfg.slug}
                stage={cfg.slug}
                label={cfg.label}
                color={cfg.color}
                leads={leadsByStage[cfg.slug] ?? []}
                onConvertLead={startConvert}
                stageLabel={stageLabel}
              />
            ))}
          </section>
        </DndContext>
      )}
    </main>
  );
}

/**
 * Abas de unidade — cada aba filtra o Kanban por uma unidade. "Todas" mostra
 * o pipeline completo; "Nao informado" agrupa leads sem unidade definida.
 * O valor da aba e o mesmo enviado a API no parametro `unit`.
 */
function UnitTabs({
  units,
  active,
  onSelect,
}: {
  units: Unit[];
  active: string;
  onSelect: (value: string) => void;
}) {
  const tabs = [
    { value: '', label: 'Todas' },
    ...units.map((unit) => ({ value: unit.name, label: unit.name })),
    { value: NAO_INFORMADO, label: 'Não informado' },
  ];

  return (
    <nav className="unit-tabs" aria-label="Pipeline por unidade">
      {tabs.map((tab) => (
        <button
          key={tab.value || 'todas'}
          type="button"
          className="unit-tab"
          data-active={active === tab.value}
          aria-pressed={active === tab.value}
          onClick={() => onSelect(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function KanbanColumn({
  stage,
  label,
  color,
  leads,
  onConvertLead,
  stageLabel,
}: {
  stage: string;
  label: string;
  color: string | null;
  leads: Lead[];
  onConvertLead: (lead: Lead) => void;
  stageLabel: (stage: string) => string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  // Cor opcional pinta a borda do topo da coluna — sinal visual leve sem
  // sobrecarregar o tema escuro/claro.
  const style: React.CSSProperties | undefined = color
    ? { borderTopColor: color, borderTopWidth: '3px', borderTopStyle: 'solid' }
    : undefined;

  return (
    <section
      ref={setNodeRef}
      className="kanban-column"
      data-over={isOver || undefined}
      aria-label={label}
      style={style}
    >
      <header className="kanban-column-header">
        <span className="kanban-column-title">{label}</span>
        <span className="kanban-column-count">{leads.length}</span>
      </header>
      <div className="kanban-column-body">
        {leads.length === 0 ? (
          <p className="kanban-empty">—</p>
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onConvert={() => onConvertLead(lead)}
              stageLabel={stageLabel}
            />
          ))
        )}
      </div>
    </section>
  );
}

function LeadCard({
  lead,
  onConvert,
  stageLabel,
}: {
  lead: Lead;
  onConvert: () => void;
  stageLabel: (stage: string) => string;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: lead.id,
  });

  // Aplica deslocamento durante o drag; transitions sao desligadas para evitar
  // jitter visual no momento do "snap" entre colunas.
  const style: React.CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  // Telefone vira link wa.me — abre a conversa do lead direto no WhatsApp.
  const waLink = whatsappLink(lead.whatsapp);

  return (
    <article
      ref={setNodeRef}
      className="kanban-card"
      data-dragging={isDragging || undefined}
      style={style}
      {...listeners}
      {...attributes}
    >
      <p className="kanban-card-name">{lead.name}</p>
      {waLink ? (
        <a
          className="kanban-card-meta kanban-card-whatsapp"
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          // Impede que o clique no link inicie o drag do card.
          onPointerDown={(event) => event.stopPropagation()}
        >
          {lead.whatsapp}
        </a>
      ) : (
        <p className="kanban-card-meta">{lead.whatsapp}</p>
      )}
      <p className="kanban-card-meta">
        {lead.unitInterest} · {lead.campaign ?? lead.source}
      </p>
      {lead.createdAt && (
        <p
          className="kanban-card-meta kanban-card-age"
          title={`Entrou em ${formatDate(lead.createdAt)}`}
        >
          {formatAge(lead.createdAt)}
        </p>
      )}
      {TERMINAL_STAGES.has(lead.stage) ? (
        <span className="status-chip">{stageLabel(lead.stage)}</span>
      ) : (
        <button
          type="button"
          className="secondary-button kanban-card-action"
          onClick={onConvert}
          onPointerDown={(event) => event.stopPropagation()}
        >
          Converter
        </button>
      )}
    </article>
  );
}
