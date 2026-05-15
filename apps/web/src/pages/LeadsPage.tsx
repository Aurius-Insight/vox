import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
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

  const load = useCallback(async () => {
    try {
      const [leadList, packageList, unitList] = await Promise.all([
        api<{ data: Lead[] }>('/api/leads?pageSize=50'),
        api<{ data: Package[] }>('/api/packages'),
        api<{ data: Unit[] }>('/api/units'),
      ]);
      setLeads(leadList.data);
      setPackages(packageList.data.filter((item) => item.active));
      setUnits(unitList.data.filter((item) => item.active));
    } catch {
      setError('Nao foi possivel carregar os leads.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function handleStageChange(leadId: string, stage: LeadStage) {
    setError('');
    try {
      const response = await api<{ data: Lead }>(`/api/leads/${leadId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      });
      setLeads((current) => current.map((lead) => (lead.id === leadId ? response.data : lead)));
    } catch (err) {
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

      <section className="table-card">
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>WhatsApp</th>
              <th>Unidade</th>
              <th>Origem</th>
              <th>Etapa</th>
              <th>Acao</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhum lead cadastrado.</td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.name}</td>
                <td>{lead.whatsapp}</td>
                <td>{lead.unitInterest}</td>
                <td>{lead.campaign ?? lead.source}</td>
                <td>
                  <select
                    value={lead.stage}
                    onChange={(event) =>
                      void handleStageChange(lead.id, event.target.value as LeadStage)
                    }
                  >
                    {LEAD_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {LEAD_STAGE_LABELS[stage]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {lead.stage === 'matriculado' ? (
                    <span className="status-chip">Matriculado</span>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => startConvert(lead)}
                    >
                      Converter
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
