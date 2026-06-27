/** Latency / duration formatting for the consumption view. */

/** Latency: 320 → "320ms", 1200 → "1.2s", 95000 → "95s". */
export function formatLatency(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

/** Coarse duration (freshness@pull): 0 → "fresh", else "3h 12m" / "12m" / "2d 3h". */
export function formatDuration(ms: number | null): string {
  if (ms == null) return 'unknown';
  if (ms < 60_000) return 'fresh';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const m = mins % 60;
    return m > 0 ? `${hrs}h ${m}m` : `${hrs}h`;
  }
  const days = Math.floor(hrs / 24);
  const h = hrs % 24;
  return h > 0 ? `${days}d ${h}h` : `${days}d`;
}

export function formatPct(ratio: number | null): string {
  if (ratio == null) return '—';
  return `${Math.round(ratio * 100)}%`;
}
