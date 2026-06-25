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

/** Free-text match over label + summary (case-insensitive). */
export function matchesSearch(f: AtlasFeature, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return f.label.toLowerCase().includes(needle) || f.summary.toLowerCase().includes(needle);
}
