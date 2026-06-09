/**
 * Queue pager — Prev / Next + "page X of N · M total" for the Case Ledger lenses.
 * Token-styled to match the ledger controls. Hidden when everything fits one page.
 * Also reused by the sweep-diff drill-to-VIPs list.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface QueuePagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** Noun for the count label (e.g. "VIPs", "cases"). */
  unit?: string;
}

export function QueuePager({ page, pageSize, total, onPage, unit = 'rows' }: QueuePagerProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const btn = (label: string, icon: React.ReactNode, to: number, disabled: boolean) => (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={() => onPage(to)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 10px',
        fontSize: 13,
        fontFamily: 'var(--font-sans)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        borderTop: '1px solid var(--border-card)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
        Page {page} of {pageCount} · {total.toLocaleString()} {unit}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        {btn('Prev', <ChevronLeft size={14} />, page - 1, page <= 1)}
        {btn('Next', <ChevronRight size={14} />, page + 1, page >= pageCount)}
      </div>
    </div>
  );
}
