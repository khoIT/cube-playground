/**
 * Three-way segmented control for a comparison chart: overlaid · grouped ·
 * indexed. Shown only for multi-series / combined artifacts (see
 * isComparisonChart). "indexed" rebases each series to 100 at the first point so
 * a magnitude gap doesn't flatten the smaller series. Tokens only.
 */

import { ReactElement } from 'react';
import { T } from '../../../shell/theme';

export type ComparisonView = 'overlaid' | 'grouped' | 'indexed';

const OPTIONS: Array<{ value: ComparisonView; label: string; title: string }> = [
  { value: 'overlaid', label: 'Overlaid', title: 'Both series on shared axes' },
  { value: 'grouped', label: 'Grouped', title: 'Side-by-side bars per category' },
  { value: 'indexed', label: 'Indexed', title: 'Rebase each series to 100 at the first point' },
];

interface Props {
  value: ComparisonView;
  onChange: (v: ComparisonView) => void;
}

export function ComparisonViewToggle({ value, onChange }: Props): ReactElement {
  return (
    <div
      role="group"
      aria-label="Comparison view"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--shell-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            style={{
              fontFamily: T.fSans,
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              padding: '3px 10px',
              border: 'none',
              cursor: 'pointer',
              background: active ? 'var(--shell-brand)' : 'transparent',
              color: active ? 'var(--text-on-brand)' : 'var(--shell-text-muted)',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** A chart is comparison-eligible when it carries ≥2 series: a dual-axis combo
 *  (two metric columns) or a series-dimension with ≥2 distinct values. */
export function isComparisonChart(
  type: string,
  data: Array<Record<string, string | number>>,
  seriesKey: string | undefined,
): boolean {
  if (type === 'dual-axis') return true;
  if (!seriesKey) return false;
  if (data.length > 0 && typeof data[0][seriesKey] === 'number') return true; // wide 2-metric
  const distinct = new Set(data.map((r) => String(r[seriesKey])));
  return distinct.size >= 2;
}
