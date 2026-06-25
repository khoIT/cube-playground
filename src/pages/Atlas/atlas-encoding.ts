/**
 * Feature Atlas — visual encoding (the §2 contract). One source of truth for
 * how health/status/effort map to design tokens + labels, shared by all 3 views
 * so the encoding is identical everywhere.
 */
import type { AtlasFeature, Effort, FeatureHealth, FeatureStatus } from './atlas-types';

interface TokenPair {
  soft: string; // background var()
  ink: string; // foreground var()
  label: string;
}

/** Health = the load-bearing triage signal → strongest channel (accent/fill). */
export const HEALTH_TOKENS: Record<FeatureHealth, TokenPair> = {
  healthy: { soft: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'Healthy' },
  partial: { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'Partial' },
  'at-risk': { soft: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'At risk' },
  stale: { soft: 'var(--muted-soft)', ink: 'var(--muted-ink)', label: 'Stale' },
};

export const STATUS_TOKENS: Record<FeatureStatus, TokenPair> = {
  idea: { soft: 'var(--muted-soft)', ink: 'var(--muted-ink)', label: 'Idea' },
  planned: { soft: 'var(--info-soft)', ink: 'var(--info-ink)', label: 'Planned' },
  'in-flight': { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'In-flight' },
  shipped: { soft: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'Shipped' },
  deprecated: { soft: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Deprecated' },
};

export const EFFORT_TOKENS: Record<Effort, TokenPair> = {
  S: { soft: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'S' },
  M: { soft: 'var(--info-soft)', ink: 'var(--info-ink)', label: 'M' },
  L: { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'L' },
  XL: { soft: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'XL' },
};

export const STATUS_ORDER: FeatureStatus[] = ['idea', 'planned', 'in-flight', 'shipped', 'deprecated'];
export const HEALTH_ORDER: FeatureHealth[] = ['at-risk', 'partial', 'stale', 'healthy'];
/** Triage sort: most-urgent health first. */
export const HEALTH_PRIORITY: Record<FeatureHealth, number> = { 'at-risk': 0, partial: 1, stale: 2, healthy: 3 };

export function healthAccent(h: FeatureHealth): string {
  return HEALTH_TOKENS[h].ink;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Human-readable reconcile stamp: "25 Jun 2026 · today" / "… · 3 days ago".
 * Accepts a bare date ("2026-06-25") or a full ISO datetime (clock time, if
 * present, is shown as written — the reconcile ritual stamps GMT+7). Relative
 * age is day-granular off the calendar date, so it never drifts by the
 * midnight-UTC hour skew that a naive Date diff would introduce.
 * Returns the raw value unchanged if it can't be parsed.
 */
export function formatReconciledAt(value: string, now: Date = new Date()): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const abs = `${d} ${MONTHS[mo - 1] ?? '?'} ${y}`;
  const t = /T(\d{2}):(\d{2})/.exec(value);
  const absWithTime = t ? `${abs}, ${t[1]}:${t[2]}` : abs;

  // Day-granular diff: compare calendar dates in the viewer's local frame.
  const stamp = Date.UTC(y, mo - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - stamp) / 86_400_000);
  let rel: string;
  if (days <= 0) rel = 'today';
  else if (days === 1) rel = 'yesterday';
  else if (days < 7) rel = `${days} days ago`;
  else if (days < 14) rel = '1 week ago';
  else if (days < 60) rel = `${Math.round(days / 7)} weeks ago`;
  else if (days < 365) rel = `${Math.round(days / 30)} months ago`;
  else rel = `${Math.round(days / 365)} year${days < 730 ? '' : 's'} ago`;

  return `${absWithTime} · ${rel}`;
}

/** Free-text match over label + summary (case-insensitive). */
export function matchesSearch(f: AtlasFeature, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return f.label.toLowerCase().includes(needle) || f.summary.toLowerCase().includes(needle);
}
