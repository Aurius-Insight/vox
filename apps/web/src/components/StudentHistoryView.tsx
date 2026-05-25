import type { StudentHistory, StudentTimelineEvent } from '../api/types';
import { formatDate, formatDateTime } from '../lib/format';

type HistoryKpisProps = {
  history: StudentHistory;
};

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDecimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

export function HistoryKpis({ history }: HistoryKpisProps) {
  const { kpis, windowDays } = history;

  return (
    <section aria-label="Indicadores do aluno">
      <p className="muted-text">Janela: ultimos {windowDays} dias</p>
      <div className="kpi-grid">
        <KpiCard
          label="Frequencia"
          value={kpis.lifetimeClasses === 0 ? '-' : formatPercent(kpis.presenceRate)}
          hint={`${formatPercent(kpis.noShowRate)} no-show`}
        />
        <KpiCard
          label="Aulas / mes"
          value={formatDecimal(kpis.averageClassesPerMonth)}
          hint={`${kpis.lifetimeClasses} aulas no historico`}
        />
        <KpiCard
          label="Ultima aula"
          value={
            kpis.daysSinceLastClass === null
              ? 'Nunca'
              : kpis.daysSinceLastClass === 0
                ? 'Hoje'
                : `${kpis.daysSinceLastClass}d atras`
          }
        />
        <KpiCard
          label="Proxima aula"
          value={kpis.nextClassAt === null ? 'Sem agenda' : formatDateTime(kpis.nextClassAt)}
        />
      </div>
    </section>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="kpi-card">
      <span className="kpi-card-label">{label}</span>
      <strong className="kpi-card-value">{value}</strong>
      {hint && <span className="kpi-card-hint">{hint}</span>}
    </article>
  );
}

const EVENT_TITLES: Record<StudentTimelineEvent['type'], string> = {
  lead_created: 'Lead criado',
  student_created: 'Aluno cadastrado',
  booking_created: 'Aula agendada',
  booking_canceled: 'Agendamento cancelado',
  attendance: 'Presenca registrada',
  package_renewed: 'Pacote renovado',
};

type HistoryTimelineProps = {
  events: StudentTimelineEvent[];
};

export function HistoryTimeline({ events }: HistoryTimelineProps) {
  if (events.length === 0) {
    return <p className="muted-text">Sem eventos na janela selecionada.</p>;
  }

  return (
    <section aria-label="Linha do tempo do aluno">
      <h3>Linha do tempo</h3>
      <ol className="timeline-list">
        {events.map((event, index) => (
          <li key={`${event.type}-${event.at}-${index}`} className={`timeline-item is-${event.type}`}>
            <div className="timeline-marker" aria-hidden="true" />
            <div className="timeline-body">
              <p className="timeline-title">{EVENT_TITLES[event.type]}</p>
              <p className="timeline-detail">{describeEvent(event)}</p>
              <p className="timeline-time muted-text">{formatDateTime(event.at)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function describeEvent(event: StudentTimelineEvent): string {
  switch (event.type) {
    case 'lead_created':
      return event.data.campaign
        ? `Campanha ${event.data.campaign} (${event.data.source})`
        : `Origem ${event.data.source}`;
    case 'student_created':
      return 'Cadastro inicial do aluno';
    case 'booking_created':
      return `${event.data.classLabel} - ${formatDate(event.data.classStartsAt)} (${event.data.kind})`;
    case 'booking_canceled':
      return `${event.data.classLabel} - ${formatDate(event.data.classStartsAt)}`;
    case 'attendance':
      return `${event.data.classLabel} - ${event.data.status === 'presente' ? 'presente' : 'no-show'}${
        event.data.creditConsumed ? ' (credito consumido)' : ''
      }`;
    case 'package_renewed':
      return `${event.data.packageName ?? 'Pacote'} - +${event.data.classesAdded} aulas`;
  }
}
