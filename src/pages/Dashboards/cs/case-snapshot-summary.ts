/**
 * Human-readable summary of a care-case stats snapshot.
 *
 * Sweep-opened cases store `{ matched_at, threshold: <ThresholdRule> }`, so the
 * "why it fired" reason is the rule itself. This renders each rule kind
 * (abs / tierStep / event / percentile / ratio) as a short phrase, and falls
 * back to the snapshot's scalar deciding stats when no threshold is present.
 *
 * Pure (no React) so the formatting is unit-testable — it replaced a naive
 * `String(value)` that rendered nested rule objects as "[object Object]".
 */

import { formatCompact } from '../../Segments/detail/cards/format-value';

const OP_SYM: Record<string, string> = { gte: '≥', lte: '≤', gt: '>', lt: '<', equals: '=' };

/** Bare member name (drop the cube prefix): "user_profile.ltv_vnd" → "ltv_vnd". */
export function shortMember(m: unknown): string {
  return String(m ?? '').split('.').pop() ?? '';
}

/** Currency for vnd/ltv/revenue/spend members, else a grouped number. */
export function fmtRuleValue(member: string, value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const m = member.toLowerCase();
  if (m.includes('vnd') || m.includes('ltv') || m.includes('revenue') || m.includes('spend')) {
    return `₫${formatCompact(n)}`;
  }
  return n.toLocaleString();
}

/** Turn a stored ThresholdRule into a readable phrase. */
export function summarizeRule(rule: Record<string, unknown>): string {
  const kind = rule.kind as string | undefined;
  const member = shortMember(rule.member ?? rule.of);
  switch (kind) {
    case 'abs':
      return `${member} ${OP_SYM[String(rule.op)] ?? String(rule.op)} ${fmtRuleValue(member, rule.value)}`;
    case 'tierStep': {
      const bands = Array.isArray(rule.bands) ? rule.bands : [];
      const top = bands[bands.length - 1] as { label?: string } | undefined;
      return `${member} tier reached${top?.label ? ` · ${top.label}` : ''}`;
    }
    case 'event':
      return `${member} in ${String(rule.window ?? 'window')}`;
    case 'percentile':
      return `${member} ≥ P${String(rule.p)}`;
    case 'ratio':
      return `${member} vs ${shortMember(rule.vs)} ${OP_SYM[String(rule.op)] ?? String(rule.op)} ${String(rule.value)}`;
    default:
      return kind ? `rule: ${kind}` : 'matched';
  }
}

/**
 * Summarize a raw stats_snapshot_json string. Returns null on empty/invalid so
 * the caller can render an em-dash. Prefers the threshold-rule summary; falls
 * back to up to three scalar deciding stats (skipping the match timestamp).
 */
export function summarizeSnapshot(raw: string | null): string | null {
  if (!raw) return null;
  let snap: Record<string, unknown>;
  try {
    snap = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!snap || typeof snap !== 'object') return null;

  const threshold = snap.threshold;
  if (threshold && typeof threshold === 'object') {
    return summarizeRule(threshold as Record<string, unknown>);
  }

  const parts = Object.entries(snap)
    .filter(([k, v]) => k !== 'matched_at' && (v == null || typeof v !== 'object'))
    .slice(0, 3)
    .map(([k, v]) => `${shortMember(k)}: ${String(v)}`);
  return parts.length ? parts.join(' · ') : 'matched';
}
