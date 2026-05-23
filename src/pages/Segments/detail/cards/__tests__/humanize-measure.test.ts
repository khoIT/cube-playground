import { describe, expect, it } from 'vitest';

import { humanizeMeasure } from '../humanize-measure';

describe('humanizeMeasure', () => {
  it('lifts the local part out of an FQN', () => {
    expect(humanizeMeasure('recharge.transactions')).toBe('Transactions');
  });

  it('lower-cases secondary words and capitalizes only the first', () => {
    expect(humanizeMeasure('mf_users.user_count')).toBe('User count');
    expect(humanizeMeasure('mf_users.paying_users')).toBe('Paying users');
  });

  it('parenthesizes currency-code suffixes', () => {
    expect(humanizeMeasure('recharge.revenue_vnd')).toBe('Revenue (VND)');
    expect(humanizeMeasure('mf_users.ltv_30d_total_usd')).toBe('Ltv (30d) total (USD)');
  });

  it('parenthesizes window-style numeric suffixes (30d, 7d, 12m)', () => {
    expect(humanizeMeasure('mf_users.paying_rate_30d')).toBe('Paying rate (30d)');
    expect(humanizeMeasure('mf_users.paying_users_7d')).toBe('Paying users (7d)');
  });

  it('falls back to the input when local part is empty', () => {
    expect(humanizeMeasure('mf_users.')).toBe('mf_users.');
  });
});
