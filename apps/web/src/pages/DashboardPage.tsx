import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
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

function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function formatDayShort(iso: string): string {
  // 2026-05-12 -> 12/05
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

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
      label: LEAD_STAGE_LABELS[row.stage] ?? row.stage,
      count: row.count,
    })) ?? [];
  const byCampaign: ChartRow[] =
    data?.leads.byCampaign.map((row) => ({ label: row.campaign, count: row.count })) ?? [];

  // Serie temporal mapeada pra eixo X amigavel (dd/mm).
  const trendSeries =
    data?.trends.series.map((row) => ({
      ...row,
      label: formatDayShort(row.date),
    })) ?? [];

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Visao geral da rede</h1>
        </div>
        <div className="header-filter">
          <span>Escola</span>
          <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
            <option value="todas">Todas as escolas</option>
            {data?.availableUnits.map((available) => (
              <option key={available.id} value={available.id}>
                {available.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* HOJE — visao operacional do dia */}
      <section className="dashboard-section">
        <h2 className="dashboard-section-title">Hoje</h2>
        <div className="metric-grid">
          <Metric label="Aulas hoje" value={data?.today.sessionsCount ?? '-'} />
          <Metric label="Alunos esperados" value={data?.today.expectedStudents ?? '-'} />
          <Metric label="Professores escalados" value={data?.today.teachersScheduled ?? '-'} />
          <Metric
            label="Presencas pendentes"
            value={data?.today.confirmationsPending ?? '-'}
            tone={data && data.today.confirmationsPending > 0 ? 'alert' : undefined}
          />
        </div>
      </section>

      {/* KPIs GERAIS */}
      <section className="dashboard-section">
        <h2 className="dashboard-section-title">Indicadores</h2>
        <div className="metric-grid">
          <Metric label="Leads" value={data?.leads.total ?? '-'} />
          <Metric label="Conversao" value={data ? `${data.sales.conversionRate}%` : '-'} />
          <Metric label="Vendas" value={data?.sales.enrolled ?? '-'} />
          <Metric label="Ocupacao de turmas" value={data ? `${data.classes.occupancy}%` : '-'} />
          <Metric label="Comparecimento" value={data ? `${data.attendance.rate}%` : '-'} />
          <Metric
            label="Experimentais agendados"
            value={data?.classes.experimentalBookings ?? '-'}
          />
          <Metric label="Aulas no mes" value={data?.classes.consumedThisMonth ?? '-'} />
          <Metric label="Alunos ativos (60d)" value={data?.students.active ?? '-'} />
          <Metric label="Sem saldo" value={data?.students.withoutBalance ?? '-'} />
          <Metric label="Base de alunos" value={data?.students.total ?? '-'} />
          <Metric label="Professores ativos" value={data?.teachers.activeCount ?? '-'} />
          <Metric
            label="Renovacoes no mes"
            value={data?.renewals.thisMonth ?? '-'}
            sub={data ? `mes anterior: ${data.renewals.lastMonth}` : undefined}
          />
        </div>
      </section>

      {/* TENDENCIAS — leads, vendas e comparecimento por dia (30d) */}
      <section className="dashboard-section">
        <h2 className="dashboard-section-title">Tendencias (30 dias)</h2>
        <div className="trend-grid">
          <TrendCard
            title="Leads novos"
            color="var(--accent)"
            dataKey="leads"
            data={trendSeries}
            loading={!data}
          />
          <TrendCard
            title="Vendas"
            color="#22c55e"
            dataKey="sales"
            data={trendSeries}
            loading={!data}
          />
          <TrendCard
            title="Presencas"
            color="#38bdf8"
            dataKey="attendance"
            data={trendSeries}
            loading={!data}
          />
        </div>
        {data && (
          <p className="muted-text dashboard-section-footnote">
            Velocidade media de lead → matricula:{' '}
            <strong>{data.trends.velocity.avgDaysLeadToEnrolled} dias</strong>
            {' '}(amostra de {data.trends.velocity.sampleSize} matriculas).
          </p>
        )}
      </section>

      {/* RANKINGS — escola, materia, pacote */}
      <section className="dashboard-section">
        <h2 className="dashboard-section-title">Comparativos</h2>
        <div className="ranking-grid">
          <article className="chart-card">
            <div className="table-card-header">
              <div>
                <strong>Por escola</strong>
                <span>Alunos ativos, aulas no mes, presenca</span>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Escola</th>
                  <th>Alunos</th>
                  <th>Aulas/mes</th>
                  <th>Presenca</th>
                </tr>
              </thead>
              <tbody>
                {(!data || data.rankings.byUnit.length === 0) && (
                  <tr>
                    <td colSpan={4}>{data ? 'Sem dados.' : 'Carregando...'}</td>
                  </tr>
                )}
                {data?.rankings.byUnit.map((row) => (
                  <tr key={row.unitId}>
                    <td>{row.unitName}</td>
                    <td>{row.students}</td>
                    <td>{row.classesThisMonth}</td>
                    <td>{row.attendanceRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="chart-card">
            <div className="table-card-header">
              <div>
                <strong>Por materia</strong>
                <span>Alunos distintos e presencas no mes</span>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Materia</th>
                  <th>Alunos</th>
                  <th>Presencas</th>
                </tr>
              </thead>
              <tbody>
                {(!data || data.rankings.bySubject.length === 0) && (
                  <tr>
                    <td colSpan={3}>{data ? 'Sem presencas no mes.' : 'Carregando...'}</td>
                  </tr>
                )}
                {data?.rankings.bySubject.map((row) => (
                  <tr key={row.subjectId}>
                    <td>{row.subjectName}</td>
                    <td>{row.students}</td>
                    <td>{row.attendances}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="chart-card">
            <div className="table-card-header">
              <div>
                <strong>Por pacote</strong>
                <span>Alunos e projecao de receita</span>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Pacote</th>
                  <th>Alunos</th>
                  <th>Projecao</th>
                </tr>
              </thead>
              <tbody>
                {(!data || data.rankings.byPackage.length === 0) && (
                  <tr>
                    <td colSpan={3}>{data ? 'Sem alunos com pacote.' : 'Carregando...'}</td>
                  </tr>
                )}
                {data?.rankings.byPackage.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.studentCount}</td>
                    <td>{formatCentsToBRL(row.revenueProjectionCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </div>
      </section>

      {/* PROFESSORES — top 8 do mes */}
      <section className="dashboard-section">
        <h2 className="dashboard-section-title">Professores (mes)</h2>
        <article className="chart-card">
          <table>
            <thead>
              <tr>
                <th>Professor</th>
                <th>Materia</th>
                <th>Aulas</th>
                <th>Alunos</th>
                <th>Presenca</th>
              </tr>
            </thead>
            <tbody>
              {(!data || data.teachers.top.length === 0) && (
                <tr>
                  <td colSpan={5}>
                    {data ? 'Sem aulas no mes.' : 'Carregando...'}
                  </td>
                </tr>
              )}
              {data?.teachers.top.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.subject ?? '-'}</td>
                  <td>{row.classesGiven}</td>
                  <td>{row.uniqueStudents}</td>
                  <td>{row.attendanceRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      {/* FUNIL: por etapa + campanha */}
      <section className="dashboard-section">
        <h2 className="dashboard-section-title">Funil</h2>
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
      </section>

      {/* PENDENCIAS — ETL + ticket medio */}
      <section className="dashboard-section">
        <h2 className="dashboard-section-title">Pendencias e indicadores extras</h2>
        <div className="metric-grid">
          <Metric
            label="Alunos vindos das planilhas"
            value={data?.etlPending.studentsFromEtl ?? '-'}
          />
          <Metric
            label="Sem WhatsApp (completar)"
            value={data?.etlPending.studentsWithoutWhatsapp ?? '-'}
            tone={data && data.etlPending.studentsWithoutWhatsapp > 0 ? 'warn' : undefined}
          />
          <Metric
            label="Datas Catete ambiguas"
            value={data?.etlPending.datesAmbiguous ?? '-'}
            tone={data && data.etlPending.datesAmbiguous > 0 ? 'warn' : undefined}
          />
          <Metric
            label="Ticket medio (renovacao)"
            value={
              data && data.renewals.avgTicketCents > 0
                ? formatCentsToBRL(data.renewals.avgTicketCents)
                : '-'
            }
          />
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'alert' | 'warn';
}) {
  return (
    <article className="metric-card" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small className="muted-text">{sub}</small>}
    </article>
  );
}

function TrendCard({
  title,
  color,
  dataKey,
  data,
  loading,
}: {
  title: string;
  color: string;
  dataKey: 'leads' | 'sales' | 'attendance';
  data: Array<{ label: string; leads: number; sales: number; attendance: number }>;
  loading: boolean;
}) {
  const total = data.reduce((sum, row) => sum + row[dataKey], 0);
  return (
    <article className="chart-card">
      <div className="table-card-header">
        <div>
          <strong>{title}</strong>
          <span>30 dias - total {total}</span>
        </div>
      </div>
      <div className="chart-body">
        {loading ? (
          <Skeleton height="160px" radius="10px" />
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                interval={Math.max(0, Math.floor(data.length / 6))}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                stroke="var(--border-strong)"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                stroke="var(--border-strong)"
                width={28}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text)',
                }}
              />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
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
