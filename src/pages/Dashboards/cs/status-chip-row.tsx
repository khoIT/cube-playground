/**
 * Status chip row — secondary, de-emphasized filter under the Playbooks bar.
 *
 * A plain chip row (no card chrome): "All" + one chip per case status, each with
 * a page-scoped count and a checkmark when selected. Multi-select accumulates;
 * empty selection = all. Tints come from the shared STATUS_STYLE so the chips
 * match the table's status pills. "Clear (n)" resets to all.
 *
 * Counts are computed from the rows currently on the page and are labelled as
 * such — they are NOT a server-side aggregate over the full ledger.
 */

import { Check } from 'lucide-react';

export const STATUS_ORDER = ['new', 'in_review', 'treated', 'resolved', 'dismissed'] as const;
export type CaseStatusKey = (typeof STATUS_ORDER)[number];

const STATUS_LABEL: Record<CaseStatusKey, string> = {
  new: 'New',
  in_review: 'In review',
  treated: 'Treated',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

const STATUS_TINT: Record<CaseStatusKey, { bg: string; ink: string }> = {
  new: { bg: 'var(--brand-soft)', ink: 'var(--brand-hover)' },
  in_review: { bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  treated: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  resolved: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  dismissed: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
};

interface StatusChipRowProps {
  selected: string[];
  onToggle: (status: string) => void;
  onClear: () => void;
  /** Page-scoped counts keyed by status (rows currently loaded). */
  counts: Record<string, number>;
}

export function StatusChipRow({ selected, onToggle, onClear, counts }: StatusChipRowProps) {
  const allActive = selected.length === 0;

  const chip = (key: CaseStatusKey) => {
    const on = selected.includes(key);
    const tint = STATUS_TINT[key];
    const count = counts[key] ?? 0;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onToggle(key)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
          padding: '4px 10px', borderRadius: 'var(--radius-full)',
          border: `1px solid ${on ? 'transparent' : 'var(--border-card)'}`,
          background: on ? tint.bg : 'transparent',
          color: on ? tint.ink : 'var(--text-muted)',
          cursor: 'pointer', transition: 'background .12s',
        }}
      >
        {on && <Check size={11} strokeWidth={3} />}
        {STATUS_LABEL[key]}
        <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>{count}</span>
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, fontFamily: 'var(--font-sans)' }}>
      <button
        type="button"
        onClick={onClear}
        style={{
          fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
          padding: '4px 12px', borderRadius: 'var(--radius-full)',
          border: `1px solid ${allActive ? 'transparent' : 'var(--border-card)'}`,
          background: allActive ? 'var(--bg-card)' : 'transparent',
          color: allActive ? 'var(--text-primary)' : 'var(--text-muted)',
          boxShadow: allActive ? 'var(--shadow-sm)' : 'none', cursor: 'pointer',
        }}
      >
        All
      </button>
      {STATUS_ORDER.map(chip)}
      {!allActive && (
        <button
          type="button"
          onClick={onClear}
          style={{
            fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-sans)',
            padding: '4px 8px', border: 0, background: 'transparent',
            color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Clear ({selected.length})
        </button>
      )}
      <span style={{ fontSize: 10.5, color: 'var(--text-tertiary, var(--text-muted))', marginLeft: 2 }}>
        counts on page
      </span>
    </div>
  );
}
