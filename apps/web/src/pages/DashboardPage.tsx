import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client';
import { LEAD_STAGE_LABELS, type DashboardData } from '../api/types';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';

type ChartRow = { label: string; count: number };

export function DashboardPage() {
  const [data, setData] = useState<DashboardData>();
  const [unitId, setUnitId] = useState('todas');
  const toast = useToast();

  const load = useCallback(
    async (selectedUnitId: string) => {
      try {
        const response = await api<{ data: DashboardData }>(
          `/api/dashboard?unitId=${encodeURIComponent(selectedUnitId)}`,
        );
        setData(response.data);
      } catch {
        toast.error('Nao foi possivel carregar o dashboard.');
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(unitId);
  }, [load, unitId]);

  const byStage: ChartRow[] =
    data?.leads.byStage.map((row) => ({
      label: LEAD_STAGE_LABELS[row.stage],
      count: row.count,
    })) ?? [];
  const byCampaign: ChartRow[] =
    data?.leads.byCampaign.map((row) => ({ label: row.campaign, count: row.count })) ?? [];

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

      <section className="metric-grid">
        <Metric label="Leads" value={data?.leads.total ?? '-'} />
        <Metric label="Conversao" value={data ? `${data.sales.conversionRate}%` : '-'} />
        <Metric label="Vendas" value={data?.sales.enrolled ?? '-'} />
        <Metric label="Ocupacao de turmas" value={data ? `${data.classes.occupancy}%` : '-'} />
        <Metric label="Comparecimento" value={data ? `${data.attendance.rate}%` : '-'} />
        <Metric
          label="Experimentais agendados"
          value={data?.classes.experimentalBookings ?? '-'}
        />
        <Metric label="Aulas consumidas no mes" value={data?.classes.consumedThisMonth ?? '-'} />
        <Metric label="Alunos ativos (60d)" value={data?.students.active ?? '-'} />
        <Metric label="Alunos sem saldo" value={data?.students.withoutBalance ?? '-'} />
        <Metric label="Base de alunos" value={data?.students.total ?? '-'} />
      </section>

      <div className="split-grid">
        <ChartCard
          title="Leads por etapa"
          subtitle="Onde os leads estao parados no funil"
          rows={byStage}
          empty="Sem leads."
          loading={!data}
        />
        <ChartCard
          title="Leads por campanha"
          subtitle="Origem do volume de leads"
          rows={byCampaign}
          empty="Sem campanhas registradas."
          loading={!data}
        />
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

function ChartCard({
  title,
  subtitle,
  rows,
  empty,
  loading,
}: {
  title: string;
  subtitle: string;
  rows: ChartRow[];
  empty: string;
  loading: boolean;
}) {
  return (
    <section className="chart-card">
      <div className="table-card-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </div>
      <div className="chart-body">
        {loading ? (
          <Skeleton height="248px" radius="10px" />
        ) : rows.length === 0 ? (
          <p className="muted-text">{empty}</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(208, rows.length * 46)}>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            >
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                stroke="var(--border-strong)"
              />
              <YAxis
                type="category"
                dataKey="label"
                width={134}
                tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                stroke="var(--border-strong)"
              />
              <Tooltip
                cursor={{ fill: 'var(--accent-soft)' }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text)',
                }}
              />
              <Bar dataKey="count" fill="var(--accent)" radius={[0, 6, 6, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
