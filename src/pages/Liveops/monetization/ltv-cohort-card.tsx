/**
 * Realized LTV-by-cohort card.
 *
 * Shows cumulative lifetime LTV per install-month cohort, bucketed into
 * age bands (D0-30 / D31-60 / D61-90). Each bar represents one install-month
 * cohort's total LTV at the time of the snapshot.
 *
 * Design notes:
 * - LTV is cumulative-at-snapshot (not per-age-increment) — disclosed in footer.
 * - Age band = days from cohort's install_month start to today. Capped at D0–90.
 * - Uses recharts BarChart grouped by age-band with install-month on the X axis.
 * - Cold Trino reads (no pre-agg on install_month) can take 10-30s; shows a
 *   skeleton while loading.
 */
import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { formatVnd } from '../../OpsConsole/ops-format';
import type { CohortLtvData, CohortLtvRow } from './use-monetization-queries';

const AGE_BAND_COLORS: Record<string, string> = {
  'D0-30':  'var(--brand)',
  'D31-60': 'var(--info-ink)',
  'D61-90': 'var(--success-ink)',
};

const ALL_BANDS = ['D0-30', 'D31-60', 'D61-90'] as const;

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        {note && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{note}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Pivot rows into wide format: one object per install-month with a key per
 * age-band. Recharts grouped-bar needs wide data.
 */
function pivotCohortRows(rows: CohortLtvRow[]): Array<Record<string, string | number>> {
  const byMonth = new Map<string, Record<string, string | number>>();
  for (const r of rows) {
    const entry = byMonth.get(r.installMonth) ?? { installMonth: r.installMonth };
    entry[r.ageBand] = (Number(entry[r.ageBand] ?? 0)) + r.cumulativeLtv;
    byMonth.set(r.installMonth, entry);
  }
  // Sort ascending by month string (lexicographic works for YYYY-MM).
  return Array.from(byMonth.values()).sort((a, b) =>
    String(a.installMonth).localeCompare(String(b.installMonth)),
  );
}

/** Which age bands are actually present in data (skip empty bands in legend). */
function presentBands(rows: CohortLtvRow[]): string[] {
  const found = new Set(rows.map((r) => r.ageBand));
  return ALL_BANDS.filter((b) => found.has(b));
}

interface Props {
  data: CohortLtvData;
}

export function LtvCohortCard({ data }: Props) {
  const wide = useMemo(() => pivotCohortRows(data.rows), [data.rows]);
  const bands = useMemo(() => presentBands(data.rows), [data.rows]);

  if (data.rows.length === 0) {
    return (
      <Panel title="Realized LTV by install cohort" note="mf_users · D0–90 cap">
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '12px 0' }}>
          No install-cohort data found for the last 90 days. This is normal for games without
          recent MMP attribution (null install_month excluded).
        </div>
      </Panel>
    );
  }

  const tooltipFormatter = (value: number, name: string) =>
    [formatVnd(value), name] as [string, string];

  const axisFormatter = (v: number) => {
    if (v >= 1e9) return `₫${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `₫${(v / 1e6).toFixed(0)}M`;
    return `₫${v}`;
  };

  return (
    <Panel title="Realized LTV by install cohort" note="mf_users · D0–90 age cap · snapshot">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={wide} margin={{ top: 8, right: 16, left: 16, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" />
          <XAxis
            dataKey="installMonth"
            stroke="var(--text-muted)"
            fontSize={10}
            label={{
              value: 'Install month',
              position: 'insideBottom',
              offset: -2,
              style: { fill: 'var(--text-muted)', fontSize: 10 },
            }}
          />
          <YAxis
            stroke="var(--text-muted)"
            fontSize={10}
            tickFormatter={axisFormatter}
            label={{
              value: 'Cumulative LTV (VND)',
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'var(--text-muted)', fontSize: 10, textAnchor: 'middle' },
            }}
          />
          <Tooltip formatter={tooltipFormatter} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {bands.map((band) => (
            <Bar
              key={band}
              dataKey={band}
              fill={AGE_BAND_COLORS[band] ?? 'var(--brand)'}
              fillOpacity={0.85}
              maxBarSize={32}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        LTV shown is cumulative lifetime revenue at snapshot time — not an age-incremental gain.
        Younger cohorts (D0-30) have had less time to monetize; comparison across cohorts reflects
        both cohort quality and age. {data.note}
      </div>
    </Panel>
  );
}
