/**
 * Small GMT+7 / relative-time formatters shared by the serving-contract UI.
 * Times shown to operators are Asia/Saigon (fixed +7), matching the snapshot job.
 */

import { formatDistanceToNowStrict } from 'date-fns';

/** Absolute GMT+7 wall-clock, e.g. "28 Jun 2026, 14:05". */
export function gmt7DateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Saigon',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Relative phrase, e.g. "3 hours ago" / "in 2 hours". */
export function relative(value: string | null | undefined): string {
  if (!value) return 'never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** Countdown phrase for next-ready: "ready now" when due/past, else "in 3h 12m". */
export function readyIn(value: string | null | undefined, nowMs: number = Date.now()): string {
  if (!value) return 'on demand';
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return '—';
  const diff = target - nowMs;
  if (diff <= 0) return 'ready now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}
