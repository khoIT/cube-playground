/**
 * Date-phrase resolver for Vietnamese + English. Returns a Cube-compatible
 * dateRange (string keyword or [ISO,ISO] tuple) plus an inferred
 * granularity hint when the phrase implies one.
 *
 * Scope is intentionally narrow: only the phrases we expect to see in
 * analytics questions. Everything else is left for the LLM to interpret.
 */

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface ResolvedDate {
  alias: string;
  dateRange: string | [string, string];
  granularity?: Granularity;
  span: [number, number];
  confidence: number;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function shiftDays(base: number, days: number): Date {
  return new Date(base + days * 24 * 60 * 60 * 1000);
}

function lastNDays(now: number, days: number): [string, string] {
  const end = new Date(now);
  const start = shiftDays(now, -days + 1);
  return [isoDate(start), isoDate(end)];
}

function quarterRange(year: number, q: number): [string, string] {
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return [isoDate(start), isoDate(end)];
}

interface Rule {
  re: RegExp;
  resolve: (m: RegExpExecArray, now: number) => Omit<ResolvedDate, 'alias' | 'span' | 'confidence'>;
}

const RULES: Rule[] = [
  { re: /\b(hôm nay|today)\b/iu, resolve: (_, n) => ({ dateRange: [isoDate(new Date(n)), isoDate(new Date(n))], granularity: 'day' }) },
  { re: /\b(hôm qua|yesterday)\b/iu, resolve: (_, n) => ({ dateRange: [isoDate(shiftDays(n, -1)), isoDate(shiftDays(n, -1))], granularity: 'day' }) },
  { re: /\b(tuần trước|tuần qua|last week)\b/iu, resolve: (_, n) => ({ dateRange: lastNDays(n, 7), granularity: 'day' }) },
  { re: /\b(tháng trước|tháng qua|last month)\b/iu, resolve: (_, n) => ({ dateRange: lastNDays(n, 30), granularity: 'day' }) },
  { re: /\b(năm trước|năm qua|last year)\b/iu, resolve: (_, n) => ({ dateRange: lastNDays(n, 365), granularity: 'month' }) },
  { re: /\b(\d{1,3})\s*(ngày|day|days)\s*(qua|trước|ago|last|past)\b/iu, resolve: (m, n) => ({ dateRange: lastNDays(n, parseInt(m[1], 10)), granularity: 'day' }) },
  { re: /\b(\d{1,3})\s*(tuần|week|weeks)\s*(qua|trước|ago|last|past)\b/iu, resolve: (m, n) => ({ dateRange: lastNDays(n, parseInt(m[1], 10) * 7), granularity: 'week' }) },
  { re: /\b(\d{1,3})\s*(tháng|month|months)\s*(qua|trước|ago|last|past)\b/iu, resolve: (m, n) => ({ dateRange: lastNDays(n, parseInt(m[1], 10) * 30), granularity: 'month' }) },
  { re: /\b(?:last|past)\s*(\d{1,3})\s*(day|days|week|weeks|month|months)\b/iu, resolve: (m, n) => {
      const qty = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const mult = unit.startsWith('week') ? 7 : unit.startsWith('month') ? 30 : 1;
      const gran: Granularity = unit.startsWith('week') ? 'week' : unit.startsWith('month') ? 'month' : 'day';
      return { dateRange: lastNDays(n, qty * mult), granularity: gran };
    } },
  { re: /\b(?:q|quý|quy)\s*([1-4])(?:\s*(\d{4}))?\b/iu, resolve: (m, n) => {
      const q = parseInt(m[1], 10);
      const year = m[2] ? parseInt(m[2], 10) : new Date(n).getUTCFullYear();
      return { dateRange: quarterRange(year, q), granularity: 'month' };
    } },
  { re: /\b(?:tháng|month)\s*(\d{1,2})(?:[\s/]+(\d{4}))?\b/iu, resolve: (m, n) => {
      const mon = parseInt(m[1], 10) - 1;
      const year = m[2] ? parseInt(m[2], 10) : new Date(n).getUTCFullYear();
      const start = new Date(Date.UTC(year, mon, 1));
      const end = new Date(Date.UTC(year, mon + 1, 0));
      return { dateRange: [isoDate(start), isoDate(end)], granularity: 'day' };
    } },
];

export function resolveDateRanges(text: string, now: number): ResolvedDate[] {
  const out: ResolvedDate[] = [];
  const seenSpans = new Set<string>();

  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const span: [number, number] = [m.index, m.index + m[0].length];
      const key = `${span[0]}-${span[1]}`;
      if (seenSpans.has(key)) continue;
      seenSpans.add(key);
      const r = rule.resolve(m, now);
      out.push({
        alias: m[0],
        span,
        confidence: 0.95,
        ...r,
      });
    }
  }

  out.sort((a, b) => a.span[0] - b.span[0]);
  return out;
}
