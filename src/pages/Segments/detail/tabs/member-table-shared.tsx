/**
 * Shared building blocks for the Members-tab tables — used by both the
 * LTV-tiered view (tiered-members-view) and the legacy random-sample fallback
 * (sample-users-tab). Extracted so the two tables can't drift on cell
 * formatting, sorting semantics, or CSV export.
 */

import { ReactElement } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { formatValue } from '../cards/format-value';
import styles from '../../segments.module.css';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  /** 'uid', 'ltv', or a memberColumnField() Cube member. */
  col: string;
  dir: SortDir;
}

export function downloadCsv(uids: string[], name: string): void {
  const blob = new Blob(['uid\n' + uids.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '_')}-uids.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatCell(value: unknown, format?: string): string {
  if (value == null || value === '') return '—';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return formatValue(value, format as never);
}

export function compareValues(a: unknown, b: unknown): number {
  const aNull = a == null || a === '';
  const bNull = b == null || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const an = typeof a === 'number' ? a : Number(a);
  const bn = typeof b === 'number' ? b : Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && typeof a !== 'string' && typeof b !== 'string') {
    return an - bn;
  }
  return String(a).localeCompare(String(b));
}

interface SortableHeaderProps {
  label: string;
  colKey: string;
  sort: SortState | null;
  onToggle: (col: string) => void;
}

export function SortableHeader({ label, colKey, sort, onToggle }: SortableHeaderProps): ReactElement {
  const active = sort?.col === colKey;
  const dir = active ? sort?.dir : null;
  return (
    <th
      className={styles.sortableHeader}
      onClick={() => onToggle(colKey)}
      data-active={active || undefined}
    >
      <span>{label}</span>
      {dir === 'asc' && <ArrowUp size={12} aria-hidden />}
      {dir === 'desc' && <ArrowDown size={12} aria-hidden />}
    </th>
  );
}
