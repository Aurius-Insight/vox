import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Valor controlado no formato "YYYY-MM-DDTHH:mm" (mesmo do input datetime-local). */
type Props = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  id?: string;
};

/**
 * Seletor de data + hora num unico painel. Substitui o input datetime-local
 * nativo (onde a data e a hora ficavam separadas). Calendario mensal + campo
 * de hora na mesma superficie. Entrada/saida no formato "YYYY-MM-DDTHH:mm".
 */
export function DateTimePicker({ value, onChange, required, id }: Props) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const datePart = value.slice(0, 10); // YYYY-MM-DD
  const timePart = value.length >= 16 ? value.slice(11, 16) : ''; // HH:mm

  // Mes visivel no calendario: ancora na data selecionada ou no mes atual.
  const [cursor, setCursor] = useState(() => {
    const base = datePart ? new Date(`${datePart}T00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  // Reancora o calendario quando a data muda por fora (ex: abrir edicao).
  useEffect(() => {
    if (!datePart) return;
    const d = new Date(`${datePart}T00:00`);
    setCursor((current) =>
      current.getFullYear() === d.getFullYear() && current.getMonth() === d.getMonth()
        ? current
        : new Date(d.getFullYear(), d.getMonth(), 1),
    );
  }, [datePart]);

  // Fecha no clique fora e no Esc.
  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const days = useMemo(() => {
    const gridStart = new Date(cursor);
    gridStart.setDate(1 - cursor.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + i);
      return day;
    });
  }, [cursor]);

  const todayKey = dateKey(new Date());
  const shiftMonth = (delta: number) =>
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  function pickDay(day: Date) {
    // Mantem a hora ja escolhida; default 08:00 na primeira selecao.
    onChange(`${dateKey(day)}T${timePart || '08:00'}`);
  }

  function changeTime(time: string) {
    if (!time) return;
    onChange(`${datePart || todayKey}T${time}`);
  }

  const display = value
    ? `${datePart.split('-').reverse().join('/')}${timePart ? ` ${timePart}` : ''}`
    : '';

  return (
    <div className="dtp" ref={wrapRef}>
      <button
        type="button"
        id={fieldId}
        className={`dtp-trigger${value ? '' : ' is-placeholder'}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{display || 'dd/mm/aaaa --:--'}</span>
        <CalendarDays size={18} aria-hidden />
      </button>

      {/* Input escondido so para a validacao nativa do form (required). */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          className="dtp-validity"
          value={value}
          required
          onChange={() => {}}
          onFocus={() => setOpen(true)}
        />
      )}

      {open && (
        <div className="dtp-panel" role="dialog" aria-label="Selecionar data e hora">
          <div className="dtp-cal-head">
            <button type="button" className="dtp-nav" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
              <ChevronLeft size={18} />
            </button>
            <strong>
              {MONTHS[cursor.getMonth()].replace(/^./, (c) => c.toUpperCase())} de{' '}
              {cursor.getFullYear()}
            </strong>
            <button type="button" className="dtp-nav" onClick={() => shiftMonth(1)} aria-label="Proximo mes">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="dtp-weekdays">
            {WEEKDAYS.map((wd) => (
              <span key={wd}>{wd}</span>
            ))}
          </div>

          <div className="dtp-grid">
            {days.map((day) => {
              const key = dateKey(day);
              const outside = day.getMonth() !== cursor.getMonth();
              const classes = ['dtp-day'];
              if (outside) classes.push('is-outside');
              if (key === todayKey) classes.push('is-today');
              if (key === datePart) classes.push('is-selected');
              return (
                <button type="button" key={key} className={classes.join(' ')} onClick={() => pickDay(day)}>
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="dtp-time">
            <label htmlFor={`${fieldId}-time`}>Hora</label>
            <input
              id={`${fieldId}-time`}
              type="time"
              value={timePart}
              onChange={(event) => changeTime(event.target.value)}
            />
            <button type="button" className="dtp-clear" onClick={() => onChange('')}>
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
