/**
 * Tests for the push-modal Selection card formatters.
 */

import { describe, it, expect } from 'vitest';
import {
  formatCategoricalValue,
  formatNumericScalar,
  parseColumnLabel,
} from '../format-selection-summary';

describe('parseColumnLabel', () => {
  it('strips the cube prefix for plain dimensions', () => {
    expect(parseColumnLabel('mf_users.country')).toEqual({ member: 'country' });
  });

  it('extracts the granularity tag for time-dim columns when supplied via map', () => {
    expect(
      parseColumnLabel('mf_users.first_login_date.week', {
        'mf_users.first_login_date.week': 'week',
      }),
    ).toEqual({ member: 'first_login_date', granularity: 'week' });
  });

  it('falls back to the raw last segment when no cube prefix', () => {
    expect(parseColumnLabel('country')).toEqual({ member: 'country' });
  });
});

describe('formatCategoricalValue', () => {
  it('formats ISO timestamps with granularity', () => {
    expect(
      formatCategoricalValue('2026-05-18T00:00:00.000', 'week'),
    ).toMatch(/2026-05-18 W\d+/);
  });

  it('passes plain string values through untouched', () => {
    expect(formatCategoricalValue('VN', undefined)).toBe('VN');
    expect(formatCategoricalValue('whale', 'week')).toBe('whale');
  });

  it('handles bare YYYY-MM-DD inputs when granularity is provided', () => {
    expect(formatCategoricalValue('2026-05-18', 'day')).toMatch(/2026-05-18/);
  });

  it('returns the input unchanged when the date is unparseable', () => {
    expect(formatCategoricalValue('not-a-date', 'week')).toBe('not-a-date');
  });
});

describe('formatNumericScalar', () => {
  it('groups thousands and clamps to 2 decimals', () => {
    const n = 201069.43;
    expect(formatNumericScalar(n)).toBe(n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  });

  it('returns the raw string for non-finite values', () => {
    expect(formatNumericScalar(Number.NaN)).toBe('NaN');
    expect(formatNumericScalar(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });
});
