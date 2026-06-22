/**
 * Sub-components and helpers used by SegmentProposalCard.
 * Split out to keep the main card file under the 200-line guideline.
 */
import React from 'react';
import { T } from '../../../shell/theme';
import type { PredicateNode, LeafNode, GroupNode, SegmentVisibility } from '../../../types/segment-api';

// ---------------------------------------------------------------------------
// Single-tunable-threshold detection (used by SegmentProposalCard)
// ---------------------------------------------------------------------------

type NumericOp = 'gt' | 'gte' | 'lt' | 'lte';
const NUMERIC_OPS: readonly string[] = ['gt', 'gte', 'lt', 'lte'];

/**
 * Returns the single tunable numeric leaf if the predicate qualifies:
 * - root is a group (AND/OR)
 * - exactly ONE leaf has a numeric op in {gt,gte,lt,lte} with a single numeric value
 * - all other leaves (if any) are non-numeric equals/in/notIn/set/notSet filters
 * Returns null otherwise.
 */
export function findTunableLeaf(node: PredicateNode): LeafNode | null {
  if (node.kind !== 'group') return null;
  const leaves = collectLeaves(node);
  const tunable = leaves.filter(
    (l) => NUMERIC_OPS.includes(l.op) && l.type === 'number' && l.values.length === 1 && typeof l.values[0] === 'number',
  );
  if (tunable.length !== 1) return null;
  const others = leaves.filter((l) => l !== tunable[0]);
  const allNonNumericComparators = others.every((l) => !NUMERIC_OPS.includes(l.op));
  return allNonNumericComparators ? tunable[0] : null;
}

function collectLeaves(node: PredicateNode): LeafNode[] {
  if (node.kind === 'leaf') return [node];
  return (node as GroupNode).children.flatMap(collectLeaves);
}

/** Deep-clone the predicate tree and set a new numeric value on the leaf with the given id. */
export function cloneTreeWithNewValue(node: PredicateNode, leafId: string, newValue: number): PredicateNode {
  if (node.kind === 'leaf') {
    return node.id === leafId ? { ...node, values: [newValue] } : node;
  }
  return { ...node, children: (node as GroupNode).children.map((c) => cloneTreeWithNewValue(c, leafId, newValue)) };
}

// ---------------------------------------------------------------------------
// NumericOp export (consumed by CutoffDistributionPicker)
// ---------------------------------------------------------------------------
export type { NumericOp };

// ---------------------------------------------------------------------------
// Predicate summariser
// ---------------------------------------------------------------------------

/**
 * Summarise a predicate tree as a flat AND/OR-joined string for the chip row.
 * Shows leaf conditions only — full group structure lives in the editor.
 */
export function summarisePredicate(node: PredicateNode, depth = 0): string {
  if (node.kind === 'leaf') {
    const vals = node.values.length
      ? node.values.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
      : '';
    return vals ? `${node.member} ${node.op} ${vals}` : `${node.member} ${node.op}`;
  }
  const children = node.children.map((c) => summarisePredicate(c, depth + 1));
  if (depth === 0) return children.join(` ${node.op} `);
  return `(${children.join(` ${node.op} `)})`;
}

// ---------------------------------------------------------------------------
// PredicateChip
// ---------------------------------------------------------------------------

/** One predicate condition rendered as a mono pill. */
export function PredicateChip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--info-soft)',
        color: 'var(--info-ink)',
        fontFamily: T.fMono,
        fontSize: 11,
        fontWeight: 500,
        maxWidth: 340,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={label}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatPill
// ---------------------------------------------------------------------------

/** Compact KPI tile: small uppercase label + 14px tabular-nums value. */
export function StatPill({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontFamily: T.fSans,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--shell-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </span>
      <span
        title={title}
        style={{
          fontFamily: T.fSans,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--shell-text)',
          fontVariantNumeric: 'tabular-nums',
          cursor: title ? 'help' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VisibilitySelect
// ---------------------------------------------------------------------------

export const VISIBILITY_LABELS: Record<SegmentVisibility, string> = {
  personal: 'Personal (only me)',
  shared: 'Shared (workspace)',
  org: 'Org-wide',
};

interface VisibilitySelectProps {
  value: SegmentVisibility;
  onChange: (v: SegmentVisibility) => void;
  disabled?: boolean;
}

export function VisibilitySelect({ value, onChange, disabled }: VisibilitySelectProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <label
        htmlFor="proposal-visibility"
        style={{
          fontFamily: T.fSans,
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--shell-text-muted)',
          flexShrink: 0,
        }}
      >
        Visibility
      </label>
      <select
        id="proposal-visibility"
        value={value}
        onChange={(e) => onChange(e.target.value as SegmentVisibility)}
        disabled={disabled}
        style={{
          fontFamily: T.fSans,
          fontSize: 12,
          color: 'var(--shell-text)',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        {(Object.entries(VISIBILITY_LABELS) as [SegmentVisibility, string][]).map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </div>
  );
}
