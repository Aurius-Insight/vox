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
import { whatsappLink } from '../lib/format';
import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  type Lead,
  type LeadStage,
  type Package,
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
  cpf: string;
  unitId: string;
  packageId: string;
};

type ConvertResponse = {
  data: {
    student: { id: string; name: string; enrollmentCode: string; packageName: string };
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

const EMPTY_CONVERT: ConvertForm = { cpf: '', unitId: '', packageId: '' };

// Etapas terminais nao aceitam mais conversao (matriculado ja foi; perdido
// virou nao-oportunidade). Para o resto, o card mostra o botao Converter.
const TERMINAL_STAGES: ReadonlySet<LeadStage> = new Set(['matriculado', 'perdido']);

const NAO_INFORMADO = 'Nao informado';

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [saving, setSaving] = useState(false);

  const [convertingLead, setConvertingLead] = useState<Lead>();
  const [convertForm, setConvertForm] = useState<ConvertForm>(EMPTY_CONVERT);
  const [convertSaving, setConvertSaving] = useState(false);

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
      const [leadList, packageList, unitList] = await Promise.all([
        api<{ data: Lead[] }>(`/api/leads?${params}`),
        api<{ data: Package[] }>('/api/packages'),
        api<{ data: Unit[] }>('/api/units'),
      ]);
      setLeads(leadList.data);
      setPackages(packageList.data.filter((item) => item.active));
      setUnits(unitList.data.filter((item) => item.active));
    } catch {
      setError('Nao foi possivel carregar os leads.');
    }
  }, [unitFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // Agrupa por etapa preservando a ordem definida em LEAD_STAGES.
  const leadsByStage = useMemo(() => {
    const grouped: Record<LeadStage, Lead[]> = {
      novo_lead: [],
      em_atendimento: [],
      pre_agendamento: [],
      experimental_agendada: [],
      matriculado: [],
      perdido: [],
    };
    for (const lead of leads) grouped[lead.stage].push(lead);
    return grouped;
  }, [leads]);

  function updateField(field: keyof LeadForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateConvertField(field: keyof ConvertForm, value: string) {
    setConvertForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError('');
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
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel criar o lead.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Drag-and-drop: ao soltar o card numa coluna diferente, faz update
   * otimista (move ja na UI) e dispara o PATCH. Em caso de erro, reverte.
   */
  async function handleDragEnd(event: DragEndEvent) {
    setError('');
    const { active, over } = event;
    if (!over) return;
    const leadId = String(active.id);
    const newStage = over.id as LeadStage;
    const lead = leads.find((item) => item.id === leadId);
    if (!lead || lead.stage === newStage) return;

    const previousStage = lead.stage;
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
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel mover o lead.');
    }
  }

  function startConvert(lead: Lead) {
    setError('');
    setInfo('');
    setConvertingLead(lead);
    setConvertForm(EMPTY_CONVERT);
  }

  function cancelConvert() {
    setConvertingLead(undefined);
  }

  async function handleConvert(event: FormEvent) {
    event.preventDefault();
    if (!convertingLead) return;
    setError('');
    setConvertSaving(true);

    try {
      const response = await api<ConvertResponse>(`/api/leads/${convertingLead.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          cpf: convertForm.cpf,
          unitId: convertForm.unitId,
          packageId: convertForm.packageId,
        }),
      });
      setInfo(
        `${response.data.student.name} convertido em aluno. Matricula ${response.data.student.enrollmentCode} - ${response.data.student.packageName}.`,
      );
      setConvertingLead(undefined);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel converter o lead.');
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
      </header>

      {error && <p className="form-error">{error}</p>}
      {info && <p className="form-info">{info}</p>}

      {convertingLead && (
        <section className="form-card">
          <h2>Converter em aluno: {convertingLead.name}</h2>
          <p className="muted-text">
            O CPF e pedido so na matricula. O saldo de aulas vem da quantidade do pacote.
          </p>
          <form className="grid-form" onSubmit={handleConvert}>
            <label>
              CPF
              <input
                value={convertForm.cpf}
                onChange={(event) => updateConvertField('cpf', event.target.value)}
                inputMode="numeric"
                required
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
            <div className="grid-form-actions">
              <div className="row-actions">
                <button type="submit" disabled={convertSaving}>
                  {convertSaving ? 'Convertendo...' : 'Confirmar matricula'}
                </button>
                <button type="button" className="secondary-button" onClick={cancelConvert}>
                  Cancelar
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      <section className="form-card">
        <h2>Novo lead</h2>
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
      </section>

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

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <section className="kanban-board" aria-label="Pipeline de leads">
          {LEAD_STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              leads={leadsByStage[stage]}
              onConvertLead={startConvert}
            />
          ))}
        </section>
      </DndContext>
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
  leads,
  onConvertLead,
}: {
  stage: LeadStage;
  leads: Lead[];
  onConvertLead: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <section
      ref={setNodeRef}
      className="kanban-column"
      data-over={isOver || undefined}
      aria-label={LEAD_STAGE_LABELS[stage]}
    >
      <header className="kanban-column-header">
        <span className="kanban-column-title">{LEAD_STAGE_LABELS[stage]}</span>
        <span className="kanban-column-count">{leads.length}</span>
      </header>
      <div className="kanban-column-body">
        {leads.length === 0 ? (
          <p className="kanban-empty">—</p>
        ) : (
          leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onConvert={() => onConvertLead(lead)} />
          ))
        )}
      </div>
    </section>
  );
}

function LeadCard({ lead, onConvert }: { lead: Lead; onConvert: () => void }) {
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
      {TERMINAL_STAGES.has(lead.stage) ? (
        <span className="status-chip">{LEAD_STAGE_LABELS[lead.stage]}</span>
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
