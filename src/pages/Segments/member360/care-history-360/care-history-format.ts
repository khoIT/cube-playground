/** Small formatters shared across Care History 360 components. */

/** Latency minutes → compact "23m" / "2h" / "1d". */
export function fmtLatency(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

/** Bubble timestamp "2026-02-05 15:27:13" → "Feb 5, 15:27" (locale, GMT+7 source). */
export function fmtMsgTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Full timestamp "2026-02-05 15:43:08.000" → "5 Feb 2026, 15:43" (locale). */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Elapsed between two timestamps as compact "23m" / "2h" / "3d"; null if unusable. */
export function fmtDuration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null;
  const s = Date.parse(startIso.replace(' ', 'T'));
  const e = Date.parse(endIso.replace(' ', 'T'));
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  const min = Math.round((e - s) / 60_000);
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

/** A title for a ticket from its top AI label (name → category → fallback). */
export function ticketTitle(labels: { category: string | null; name: string | null }[]): string {
  const first = labels[0];
  if (!first) return 'Support ticket';
  return first.name ?? first.category ?? 'Support ticket';
}
