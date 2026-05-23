/**
 * humanizeMeasure — derive a short, human-readable label from a Cube
 * measure / dimension FQN. Used by Insights cards to surface what the
 * displayed number actually represents (transactions, users, revenue, …)
 * so chart titles like "Payment channel" don't leave the user guessing.
 *
 * Examples:
 *   recharge.transactions      → 'Transactions'
 *   recharge.revenue_vnd       → 'Revenue (VND)'
 *   mf_users.paying_rate_30d   → 'Paying rate (30d)'
 *   mf_users.user_count        → 'User count'
 *   mf_users.paying_users      → 'Paying users'
 */

const CURRENCY_CODES = new Set([
  'vnd', 'usd', 'eur', 'gbp', 'jpy', 'krw', 'cny', 'inr', 'thb', 'sgd',
]);

export function humanizeMeasure(fqn: string): string {
  const local = (fqn.split('.').pop() ?? fqn).trim();
  if (!local) return fqn;

  const tokens = local.split('_').filter(Boolean);
  const out: string[] = [];
  const buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    const phrase = buffer.join(' ');
    out.push(out.length === 0 ? capitalize(phrase) : phrase);
    buffer.length = 0;
  };

  for (const tok of tokens) {
    if (CURRENCY_CODES.has(tok.toLowerCase())) {
      flush();
      out.push(`(${tok.toUpperCase()})`);
    } else if (/^\d+[a-z]?$/i.test(tok)) {
      // Bucket-style suffixes — "30d", "7d", "12m" — collapse into a parenthetical.
      flush();
      out.push(`(${tok})`);
    } else {
      buffer.push(tok);
    }
  }
  flush();
  return out.join(' ').replace(/\s+\(/g, ' (');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
