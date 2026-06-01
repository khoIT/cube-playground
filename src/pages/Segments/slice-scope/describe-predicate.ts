/**
 * Render a predicate tree as a short, human-readable list of chip strings for
 * the "metrics are scoped to this slice" notices. Pure, display-only — not a
 * substitute for the canonical translator.
 *
 * Top-level AND children become separate chips. OR groups (and nested groups)
 * are rendered inline as `(a OR b)` so the chip count stays small.
 */

import type { PredicateNode, LeafNode } from '../../../types/segment-api';

const OP_LABEL: Record<string, string> = {
  equals: '=',
  notEquals: '≠',
  in: 'in',
  notIn: 'not in',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  contains: 'contains',
  set: 'is set',
  notSet: 'is not set',
  inDateRange: 'in',
  beforeDate: 'before',
  afterDate: 'after',
};

/** Strip the `cube.` prefix for readability (`recharge.os_platform` → `os_platform`). */
function shortMember(member: string): string {
  const dot = member.indexOf('.');
  return dot >= 0 ? member.slice(dot + 1) : member;
}

function formatValues(node: LeafNode): string {
  if (node.op === 'set' || node.op === 'notSet') return '';
  const v = node.values;
  // inDateRange carries [[start, end]] or [start, end] — render as a range.
  if (node.op === 'inDateRange') {
    const pair =
      v.length === 1 && Array.isArray(v[0]) ? (v[0] as unknown[]) : v;
    if (pair.length === 2) return `${pair[0]} → ${pair[1]}`;
    return String(v[0] ?? '');
  }
  return v.map(String).join(', ');
}

function describeLeaf(node: LeafNode): string {
  const op = OP_LABEL[node.op] ?? node.op;
  const values = formatValues(node);
  return values ? `${shortMember(node.member)} ${op} ${values}` : `${shortMember(node.member)} ${op}`;
}

function describeInline(node: PredicateNode): string {
  if (node.kind === 'leaf') return describeLeaf(node);
  const conj = node.op === 'AND' ? ' AND ' : ' OR ';
  const inner = node.children.map(describeInline).join(conj);
  return `(${inner})`;
}

export function describePredicate(node: PredicateNode | null): string[] {
  if (!node) return [];
  // Flatten a root AND into one chip per child; anything else is a single chip.
  if (node.kind === 'group' && node.op === 'AND') {
    return node.children.map(describeInline);
  }
  return [describeInline(node)];
}
