/**
 * Member-row redaction guard for the advisor agent.
 *
 * Any tool output that can carry member-level rows passes through this before
 * the rows enter agent context. The posture mirrors the ranked-members pull API:
 * only an opaque identity key, numeric metrics, and an explicit reachability
 * flag survive. Every other string-valued column (names, emails, phones, free
 * text) is dropped — the agent reasons in counts/rates, never on contact data.
 *
 * The filter is allow-by-shape, not deny-by-list: a column survives only if its
 * key is a known identity/reachability key OR its value is numeric. New PII
 * columns added upstream are therefore stripped by default, not leaked.
 */

/** Identity keys that stay (opaque join keys, not contact details). */
const IDENTITY_KEYS = new Set(['user_id', 'uid', 'member_id', 'id', 'rank']);

/** Reachability / contactability flags the advisor legitimately needs. */
const REACHABILITY_KEYS = new Set(['reachable', 'reachability', 'contactable', 'reachable_pct']);

/**
 * Defensive denylist — never survives even if numeric-looking. Includes the
 * numeric-valued identifiers (msisdn/zalo_id/vga_id) that the allow-by-shape
 * rule would otherwise pass through.
 */
const PII_DENY = new Set([
  'email',
  'phone',
  'phone_number',
  'msisdn',
  'name',
  'full_name',
  'ingame_name',
  'contact',
  'address',
  'ip',
  'device_id',
  'zalo_id',
  'vga_id',
  'national_id',
  'passport',
]);

/**
 * Substrings that mark a column as contact PII regardless of prefix/suffix
 * (e.g. user_email, recharge_phone). Kept deliberately narrow — only fragments
 * that never appear in a legitimate analytical dimension — so aggregate
 * dimension labels (game_name, event_name) are NOT over-stripped.
 */
const PII_SUBSTR = ['email', 'phone', 'msisdn', 'passport'];

/**
 * Cube /load returns rows keyed by FULLY-QUALIFIED member names
 * (e.g. "mf_users.ingame_name"), so match on the unqualified tail, not the
 * whole key — otherwise the denylist silently misses every real Cube column.
 */
function keyTail(key: string): string {
  const k = key.toLowerCase();
  const dot = k.lastIndexOf('.');
  return dot >= 0 ? k.slice(dot + 1) : k;
}

function isDeniedKey(key: string): boolean {
  const tail = keyTail(key);
  return PII_DENY.has(tail) || PII_SUBSTR.some((s) => tail.includes(s));
}

function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
  return false;
}

function isAllowedKey(key: string): boolean {
  if (isDeniedKey(key)) return false;
  const tail = keyTail(key);
  return IDENTITY_KEYS.has(tail) || REACHABILITY_KEYS.has(tail);
}

/** Redact a single member row to the allowlisted shape. */
export function redactMemberRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isDeniedKey(key)) continue; // hard deny — even if numeric
    if (isAllowedKey(key) || isNumericValue(value)) out[key] = value;
  }
  return out;
}

/** Redact an array of member rows. */
export function redactMemberRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map(redactMemberRow);
}

/**
 * Strip obvious PII columns from analytical (aggregate) rows WITHOUT collapsing
 * useful dimension labels (country, platform, …). Used by the cube query tool,
 * where the agent legitimately needs string dimensions but must never see a
 * contact column. This is laxer than redactMemberRow on purpose — aggregate
 * queries are not member-level.
 */
export function stripPiiColumns(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (isDeniedKey(key)) continue; // tail-match handles dotted Cube keys
      out[key] = value;
    }
    return out;
  });
}
