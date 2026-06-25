import { describe, it, expect } from 'vitest';
import { formatReconciledAt } from '../atlas-encoding';

describe('formatReconciledAt', () => {
  const now = new Date(2026, 5, 25); // 25 Jun 2026, local

  it('formats a bare date as human-readable absolute + relative', () => {
    expect(formatReconciledAt('2026-06-25', now)).toBe('25 Jun 2026 · today');
    expect(formatReconciledAt('2026-06-24', now)).toBe('24 Jun 2026 · yesterday');
    expect(formatReconciledAt('2026-06-22', now)).toBe('22 Jun 2026 · 3 days ago');
  });

  it('uses day-granular relative for weeks/months (no midnight-UTC skew)', () => {
    expect(formatReconciledAt('2026-06-18', now)).toBe('18 Jun 2026 · 1 week ago');
    expect(formatReconciledAt('2026-06-04', now)).toBe('4 Jun 2026 · 3 weeks ago');
    expect(formatReconciledAt('2026-04-25', now)).toBe('25 Apr 2026 · 2 months ago');
  });

  it('shows clock time when the value carries one', () => {
    expect(formatReconciledAt('2026-06-25T17:20:00+07:00', now)).toBe('25 Jun 2026, 17:20 · today');
  });

  it('returns the raw value unchanged when unparseable, and empty for empty', () => {
    expect(formatReconciledAt('not-a-date', now)).toBe('not-a-date');
    expect(formatReconciledAt('', now)).toBe('');
  });
});
