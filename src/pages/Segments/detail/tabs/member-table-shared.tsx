/**
 * Shared building blocks for the Members-tab tables — used by both the
 * LTV-tiered view (tiered-members-view) and the legacy random-sample fallback
 * (sample-users-tab). Extracted so the two tables can't drift on cell
 * formatting, sorting semantics, or CSV export.
 */

import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { formatValue } from '../cards/format-value';
import { memberColumnField } from './use-member-dim-rows';
import type { MemberColumnSpec } from '../../presets/types';
import styles from '../../segments.module.css';

/** The preset memberColumn that carries the friendly identity (in-game name).
 *  It renders inside the identity cell, not as a separate data column. */
const NAME_COLUMN_ID = 'name';

/** Split the in-game-name column (when the preset/game models one) from the
 *  ordinary data columns: the name feeds the identity cell, the rest render
 *  as regular enrichment columns. */
export function splitNameColumn(columns: MemberColumnSpec[]): {
  nameField: string | null;
  dataColumns: MemberColumnSpec[];
} {
  const nameCol = columns.find((c) => c.id === NAME_COLUMN_ID);
  return {
    nameField: nameCol ? memberColumnField(nameCol) : null,
    dataColumns: columns.filter((c) => c.id !== NAME_COLUMN_ID),
  };
}

/**
 * Identity cell shared by both member tables. The in-game name is the primary,
 * 360-linked line (friendlier than a snowflake uid); the uid drops to a small
 * mono secondary line. Games without a name dim keep the uid as the primary
 * link — exact prior behavior.
 */
export function MemberIdentityCell({
  uid,
  name,
  segmentId,
  member360Enabled,
  linkTitle,
}: {
  uid: string;
  name: string | null;
  segmentId: string;
  member360Enabled: boolean;
  linkTitle: string;
}): ReactElement {
  const primary = name ?? uid;
  const link = member360Enabled ? (
    <Link
      to={`/segments/${segmentId}/members/${encodeURIComponent(uid)}`}
      style={{ color: 'var(--brand)', textDecoration: 'none', fontWeight: name ? 600 : 400 }}
      title={linkTitle}
    >
      {primary}
    </Link>
  ) : (
    <span style={{ fontWeight: name ? 600 : 400 }}>{primary}</span>
  );
  return (
    <td style={{ fontFamily: name ? 'var(--font-sans)' : 'var(--font-mono)' }}>
      {link}
      {name && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {uid}
        </div>
      )}
    </td>
  );
}

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

/**
 * Enrichment columns that actually produced data for the visible rows.
 * While the dim query is in flight all columns stay (cells render "…");
 * once it settles, columns whose every visible cell is empty are dropped —
 * a preset column that doesn't resolve for this game/cube (broken join,
 * missing dim, silent query failure) renders nothing instead of a wall of
 * dashes.
 */
export function columnsWithData(
  columns: MemberColumnSpec[],
  byUid: Map<string, Record<string, unknown>>,
  visibleUids: string[],
  loading: boolean,
): MemberColumnSpec[] {
  if (loading) return columns;
  return columns.filter((c) => {
    const field = memberColumnField(c);
    return visibleUids.some((uid) => {
      const v = byUid.get(uid)?.[field];
      return v != null && v !== '';
    });
  });
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
