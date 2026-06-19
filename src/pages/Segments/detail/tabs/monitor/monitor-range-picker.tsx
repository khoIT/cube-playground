/**
 * Compact from/to range picker for the Monitor control bar. Native date inputs
 * (no moment/dayjs coupling) plus quick-window chips, design-token styled to sit
 * inline beside the view-grain toggle. Emits inclusive YYYY-MM-DD ranges; the
 * tab clamps the emitted range to the active grain's cap (see monitor-range.ts),
 * so this control only enforces from ≤ to and the daily ceiling.
 */

import { ReactElement } from 'react';
import { CalendarRange } from 'lucide-react';
import {
  addDays,
  dayCountInclusive,
  todayInSaigon,
  MAX_DAILY_DAYS,
  type DateRange,
} from './monitor-range';
import styles from '../../../segments.module.css';

interface Props {
  value: DateRange;
  onChange: (next: DateRange) => void;
}

/** Quick windows (days back from today). Daily-grain friendly defaults. */
const QUICK: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function MonitorRangePicker({ value, onChange }: Props): ReactElement {
  const today = todayInSaigon();
  const span = dayCountInclusive(value.from, value.to);

  function setFrom(from: string): void {
    if (!from || from > value.to) return;
    if (dayCountInclusive(from, value.to) > MAX_DAILY_DAYS) return;
    onChange({ from, to: value.to });
  }
  function setTo(to: string): void {
    if (!to || to < value.from || to > today) return;
    if (dayCountInclusive(value.from, to) > MAX_DAILY_DAYS) return;
    onChange({ from: value.from, to });
  }
  function applyQuick(days: number): void {
    onChange({ from: addDays(today, -(days - 1)), to: today });
  }

  return (
    <div className={styles.rangePicker}>
      <CalendarRange size={14} aria-hidden className={styles.rangePickerIcon} />
      <input
        type="date"
        aria-label="Window start"
        value={value.from}
        max={value.to}
        onChange={(e) => setFrom(e.target.value)}
        className={styles.rangeInput}
      />
      <span className={styles.rangeArrow}>→</span>
      <input
        type="date"
        aria-label="Window end"
        value={value.to}
        min={value.from}
        max={today}
        onChange={(e) => setTo(e.target.value)}
        className={styles.rangeInput}
      />
      <div className={styles.rangeQuick} role="group" aria-label="Quick windows">
        {QUICK.map((q) => {
          const active = span === q.days && value.to === today;
          return (
            <button
              key={q.label}
              type="button"
              className={[styles.rangeQuickChip, active ? styles.rangeQuickChipActive : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => applyQuick(q.days)}
            >
              {q.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
