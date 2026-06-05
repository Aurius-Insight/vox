import { useMemo, useState } from 'react';
import type { ClassSession } from '../api/types';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Calendario mensal da agenda. Cada dia lista as aulas; clicar numa aula
// abre a edicao (mesma acao da lista).
export function AgendaCalendar({
  classes,
  onSelect,
}: {
  classes: ClassSession[];
  onSelect: (classSession: ClassSession) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const todayKey = dateKey(new Date());

  const byDay = useMemo(() => {
    const map = new Map<string, ClassSession[]>();
    for (const item of classes) {
      const key = dateKey(new Date(item.startsAt));
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }
    return map;
  }, [classes]);

  const gridStart = new Date(cursor);
  gridStart.setDate(1 - cursor.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    days.push(day);
  }

  const monthLabel = cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const shiftMonth = (delta: number) =>
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  return (
    <section className="table-card calendar">
      <div className="calendar-toolbar">
        <strong className="calendar-month">{monthLabel}</strong>
        <div className="row-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => shiftMonth(-1)}
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setCursor(startOfMonth(new Date()))}
          >
            Hoje
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => shiftMonth(1)}
            aria-label="Proximo mes"
          >
            ›
          </button>
        </div>
      </div>

      <div className="calendar-grid calendar-weekdays">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((day) => {
          const key = dateKey(day);
          const dayClasses = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className="calendar-cell"
              data-other={day.getMonth() !== cursor.getMonth() || undefined}
              data-today={key === todayKey || undefined}
            >
              <span className="calendar-daynum">{day.getDate()}</span>
              <div className="calendar-events">
                {dayClasses.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="calendar-event"
                    onClick={() => onSelect(item)}
                    title={`${item.displayName} · ${item.teacherName ?? 'Convidado'} · ${item.unitName ?? '-'} · ${item.bookedCount}/${item.capacity}`}
                  >
                    <span className="calendar-event-time">{formatTime(item.startsAt)}</span>{' '}
                    {item.displayName}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
