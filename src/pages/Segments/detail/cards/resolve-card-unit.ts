/**
 * resolveCardUnit — derive a short unit token ("users", "VND", "%") from a
 * Cube measure FQN for the chart-card header chip. Falls back to the
 * humanized measure name when no unit is derivable, and returns null when
 * the chip would only repeat what the card title already says.
 */

import { humanizeMeasure } from './humanize-measure';

const CURRENCY_CODES = new Set([
  'vnd', 'usd', 'eur', 'gbp', 'jpy', 'krw', 'cny', 'inr', 'thb', 'sgd',
]);

/** Pure unit token for a measure, or null when none is derivable. */
export function resolveCardUnit(measure: string): string | null {
  const local = (measure.split('.').pop() ?? measure).toLowerCase();
  const tokens = local.split('_').filter(Boolean);

  for (const tok of tokens) {
    if (CURRENCY_CODES.has(tok)) return tok.toUpperCase();
  }
  if (/rate|percent|pct|share|ratio/.test(local)) return '%';
  if (/revenue|ltv|arpu|arppu|spend|amount/.test(local)) return 'VND';
  if (/user|uid|payer|player|member|account|install|dau|wau|mau/.test(local)) return 'users';
  if (/transaction|txn|order/.test(local)) return 'txns';
  if (/session/.test(local)) return 'sessions';
  if (/duration|seconds|time_spent/.test(local)) return 'sec';
  return null;
}

/** Normalize for redundancy comparison: lowercase word tokens, plural-stripped. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((t) => t.replace(/s$/, '')),
  );
}

/**
 * Header-chip text for a card: a pure unit token when derivable, otherwise
 * the humanized measure. Returns null when every word of the chip already
 * appears in the title — the chip must add information, not echo it.
 */
export function cardUnitChip(measure: string, title: string): string | null {
  const chip = resolveCardUnit(measure) ?? humanizeMeasure(measure);
  if (!chip) return null;
  const titleTokens = tokenize(title);
  const chipTokens = [...tokenize(chip)];
  const redundant = chipTokens.length > 0 && chipTokens.every((t) => titleTokens.has(t));
  return redundant ? null : chip;
}
