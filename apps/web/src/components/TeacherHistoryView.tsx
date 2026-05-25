import type { TeacherKpis, TeacherTimelineEvent, TeachingHistory } from '../api/types';
import { formatDateTime } from '../lib/format';

function formatPercent(value: number, total: number): string {
  if (total === 0) return '-';
  return `${Math.round(value * 100)}%`;
}

function formatHours(value: number | null): string {
  if (value === null) return '-';
  if (Math.abs(value) < 1) {
    const minutes = Math.round(value * 60);
    return `${minutes}min`;
  }
  return `${value.toFixed(1).replace('.', ',')}h`;
}

type KpisProps = {
  kpis: TeacherKpis;
  windowDays: number;
};

export function TeacherKpisView({ kpis, windowDays }: KpisProps) {
  const attendanceTotal = kpis.classesTaught;
  return (
    <section aria-label="Indicadores do professor">
      <p className="muted-text">Janela: ultimos {windowDays} dias</p>
      <div className="kpi-grid">
        <KpiCard label="Aulas dadas" value={String(kpis.classesTaught)} />
        <KpiCard label="Alunos unicos" value={String(kpis.uniqueStudents)} />
        <KpiCard
          label="Presenca"
          value={formatPercent(kpis.presenceRate, attendanceTotal)}
          hint={`${formatPercent(kpis.noShowRate, attendanceTotal)} no-show`}
        />
        <KpiCard
          label="Pontualidade"
          value={formatHours(kpis.averagePunctualityHours)}
          hint="apos o fim da aula"
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

const EVENT_TITLES: Record<TeacherTimelineEvent['type'], string> = {
  class_taught: 'Aula dada',
  class_canceled: 'Aula cancelada',
};

type TimelineProps = {
  events: TeacherTimelineEvent[];
};

export function TeacherTimelineView({ events }: TimelineProps) {
  if (events.length === 0) {
    return <p className="muted-text">Sem aulas na janela selecionada.</p>;
  }

  return (
    <section aria-label="Linha do tempo do professor">
      <h3>Linha do tempo</h3>
      <ol className="timeline-list">
        {events.map((event, index) => (
          <li key={`${event.data.sessionId}-${index}`} className={`timeline-item is-${event.type}`}>
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

function describeEvent(event: TeacherTimelineEvent): string {
  const subject = event.data.subject ?? 'Sem materia';
  const unit = event.data.unit ?? 'Sem unidade';
  if (event.type === 'class_canceled') {
    return `${subject} - ${unit}`;
  }
  return `${subject} - ${unit} - ${event.data.present}/${event.data.capacity} presentes (${event.data.noShow} no-show)`;
}

export function TeachingHistoryView({ history }: { history: TeachingHistory }) {
  return (
    <div className="stack">
      <TeacherKpisView kpis={history.kpis} windowDays={history.windowDays} />
      <TeacherTimelineView events={history.timeline} />
    </div>
  );
}
