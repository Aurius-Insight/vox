import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { LEAD_STAGE_LABELS, type DashboardData } from '../api/types';

export function DashboardPage() {
  const [data, setData] = useState<DashboardData>();
  const [unitId, setUnitId] = useState('todas');
  const [error, setError] = useState('');

  const load = useCallback(async (selectedUnitId: string) => {
    try {
      const response = await api<{ data: DashboardData }>(
        `/api/dashboard?unitId=${encodeURIComponent(selectedUnitId)}`,
      );
      setData(response.data);
    } catch {
      setError('Nao foi possivel carregar o dashboard.');
    }
  }, []);

  useEffect(() => {
    void load(unitId);
  }, [load, unitId]);

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Visao geral da rede</h1>
        </div>
        <div className="header-filter">
          <span>Unidade</span>
          <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
            <option value="todas">Todas as unidades</option>
            {data?.availableUnits.map((available) => (
              <option key={available.id} value={available.id}>
                {available.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}

      <section className="metric-grid">
        <Metric label="Leads" value={data?.leads.total ?? '-'} />
        <Metric label="Conversao" value={data ? `${data.sales.conversionRate}%` : '-'} />
        <Metric label="Vendas" value={data?.sales.enrolled ?? '-'} />
        <Metric label="Ocupacao de turmas" value={data ? `${data.classes.occupancy}%` : '-'} />
        <Metric label="Comparecimento" value={data ? `${data.attendance.rate}%` : '-'} />
        <Metric label="Experimentais agendados" value={data?.classes.experimentalBookings ?? '-'} />
        <Metric label="Aulas consumidas no mes" value={data?.classes.consumedThisMonth ?? '-'} />
        <Metric label="Alunos ativos (60d)" value={data?.students.active ?? '-'} />
        <Metric label="Alunos sem saldo" value={data?.students.withoutBalance ?? '-'} />
        <Metric label="Base de alunos" value={data?.students.total ?? '-'} />
      </section>

      <div className="split-grid">
        <section className="table-card">
          <div className="table-card-header">
            <div>
              <strong>Leads por etapa</strong>
              <span>Onde os leads estao parados no funil</span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Etapa</th>
                <th>Leads</th>
              </tr>
            </thead>
            <tbody>
              {(!data || data.leads.byStage.length === 0) && (
                <tr>
                  <td colSpan={2}>Sem leads.</td>
                </tr>
              )}
              {data?.leads.byStage.map((row) => (
                <tr key={row.stage}>
                  <td>{LEAD_STAGE_LABELS[row.stage]}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <strong>Leads por campanha</strong>
              <span>Origem do volume de leads</span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Campanha</th>
                <th>Leads</th>
              </tr>
            </thead>
            <tbody>
              {(!data || data.leads.byCampaign.length === 0) && (
                <tr>
                  <td colSpan={2}>Sem campanhas registradas.</td>
                </tr>
              )}
              {data?.leads.byCampaign.map((row) => (
                <tr key={row.campaign}>
                  <td>{row.campaign}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
