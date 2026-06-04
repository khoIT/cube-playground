/**
 * Bounded date-range control for the Behavior section. Offers only presets
 * (7 / 14 / 30 days) — every option is ≤ the cube.js MAX_RANGE_DAYS (31) guard,
 * so no choice can ever produce an unbounded or over-range behavior query.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateRange } from './build-panel-query';

const PRESETS: Array<{ id: string; days: number; label: string }> = [
  { id: 'last_7d', days: 7, label: '7d' },
  { id: 'last_14d', days: 14, label: '14d' },
  { id: 'last_30d', days: 30, label: '30d' },
];

export function rangeForDays(days: number, today = new Date()): DateRange {
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  return [from, to];
}

interface Props {
  activeId: string;
  onChange: (id: string, range: DateRange) => void;
}

export function BehaviorDateRange({ activeId, onChange }: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        {t('segments.member360.window', { defaultValue: 'Window' })}
      </span>
      <div style={{ display: 'inline-flex', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {PRESETS.map((p) => {
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id, rangeForDays(p.days))}
              style={{
                border: 'none',
                padding: '3px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: active ? 'var(--brand)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
