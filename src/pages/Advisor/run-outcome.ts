/**
 * Shared mapping from an advisor run's terminal stop-reason to a user-facing
 * outcome label + semantic tone. Used by the run-history list and the replay
 * header so both read the same way. Tokens adapt for dark mode.
 */

export type OutcomeTone = 'success' | 'warning' | 'muted' | 'destructive';

export interface RunOutcome {
  label: string;
  tone: OutcomeTone;
}

export function runOutcome(stopReason: string | null): RunOutcome {
  switch (stopReason) {
    case 'end_turn':
      return { label: 'Completed', tone: 'success' };
    case 'timeout':
      return { label: 'Timed out', tone: 'warning' };
    case 'max_turns':
      return { label: 'Step limit', tone: 'warning' };
    case 'budget':
    case 'budget_exceeded':
      return { label: 'Cost cap', tone: 'warning' };
    case 'aborted':
      return { label: 'Stopped', tone: 'muted' };
    case 'error':
      return { label: 'Error', tone: 'destructive' };
    default:
      return { label: stopReason ?? 'In progress', tone: 'muted' };
  }
}

/** CSS-variable pair (soft background, ink text) for an outcome tone. */
export function outcomeColors(tone: OutcomeTone): { bg: string; ink: string } {
  switch (tone) {
    case 'success':
      return { bg: 'var(--success-soft)', ink: 'var(--success-ink)' };
    case 'warning':
      return { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' };
    case 'destructive':
      return { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)' };
    default:
      return { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' };
  }
}

/** Compact relative-time label ("just now", "3h ago", "2d ago"). */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/** "Revenue" / "Engagement" / "Both" from the goal slug. */
export function goalLabel(goal: string): string {
  if (!goal) return 'Investigation';
  return goal.charAt(0).toUpperCase() + goal.slice(1);
}

/** Human scope: "segment 1a2b3c…" or the bare game id. */
export function scopeLabel(scopeKind: string, gameId: string, segmentId: string | null): string {
  if (scopeKind === 'segment' && segmentId) return `segment ${segmentId.slice(0, 8)}…`;
  return gameId;
}
