/**
 * Pure window math for the Ops Console (unit-tested in Phase 6).
 *
 * Maps a window selection to a current date range and, ONLY for 7d, a prior
 * equal-length range for Δ-vs-prior. 30d and MTD return no prior range: there is
 * no billing history before ~mid-May, so a 30d prior period is empty (a fake
 * +∞% Δ). Snapshot cards never use these ranges at all.
 *
 * Ranges are inclusive YYYY-MM-DD strings (Cube `dateRange`). All windows are
 * ≤31 days so they satisfy billing_detail's scan guard. `today` is injectable so
 * tests are deterministic.
 */

export type OpsWindow = '7d' | '30d' | 'mtd';

export interface OpsRange {
  start: string;
  end: string;
}

export interface OpsWindowRanges {
  current: OpsRange;
  /** Prior equal-length period — only for 7d; null for 30d / MTD. */
  prior: OpsRange | null;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function opsWindowRanges(window: OpsWindow, today: Date = new Date()): OpsWindowRanges {
  const end = fmt(today);

  if (window === '7d') {
    const start = addDays(end, -6); // 7 inclusive days
    return {
      current: { start, end },
      prior: { start: addDays(start, -7), end: addDays(start, -1) },
    };
  }

  if (window === '30d') {
    return { current: { start: addDays(end, -29), end }, prior: null };
  }

  // MTD — first of the current month → today.
  const first = new Date(`${end}T00:00:00Z`);
  first.setUTCDate(1);
  return { current: { start: fmt(first), end }, prior: null };
}

/** Δ as a signed fraction (current-prior)/prior, or null when not computable. */
export function pctDelta(current: number, prior: number | null | undefined): number | null {
  if (prior == null || prior === 0) return null;
  return (current - prior) / prior;
}
