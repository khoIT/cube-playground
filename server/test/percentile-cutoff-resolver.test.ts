import { describe, it, expect } from 'vitest';
import {
  buildPercentileSql,
  resolvePercentileCutoff,
  type PercentileQuery,
} from '../src/services/percentile-cutoff-resolver.js';

describe('buildPercentileSql', () => {
  it('emits approx_percentile over the population table', () => {
    const sql = buildPercentileSql({ table: 'cfm.billing_lifetime', column: 'lifetime_vnd', p: 75 });
    expect(sql).toBe(
      'SELECT approx_percentile(lifetime_vnd, 0.75) AS cutoff FROM cfm.billing_lifetime',
    );
  });

  it('has no free-text gate surface (population restriction is structured, not raw SQL)', () => {
    // Regression guard for the removed gateSql injection surface: the only inputs
    // are validated identifiers; there is no raw WHERE fragment to inject through.
    const sql = buildPercentileSql({ table: 'cfm.billing_lifetime', column: 'lifetime_vnd', p: 90 });
    expect(sql).toBe('SELECT approx_percentile(lifetime_vnd, 0.9) AS cutoff FROM cfm.billing_lifetime');
    expect(sql).not.toContain('WHERE');
  });

  it('rejects an invalid table identifier', () => {
    expect(() =>
      buildPercentileSql({ table: 'cfm; DROP TABLE x', column: 'c', p: 50 }),
    ).toThrow(/invalid table/);
  });

  it('converts p (0-100) to a Trino fraction (0-1)', () => {
    expect(buildPercentileSql({ table: 't', column: 'c', p: 50 })).toContain('approx_percentile(c, 0.5)');
  });

  it('rejects an out-of-range percentile', () => {
    expect(() => buildPercentileSql({ table: 't', column: 'c', p: 150 })).toThrow(/p must be in \[0,100\]/);
    expect(() => buildPercentileSql({ table: 't', column: 'c', p: -1 })).toThrow(/p must be in \[0,100\]/);
  });
});

describe('resolvePercentileCutoff', () => {
  it('resolves through the injected executor and returns the cutoff', async () => {
    let seen: PercentileQuery | null = null;
    const cutoff = await resolvePercentileCutoff(
      'lifetime_vnd',
      { p: 75, over: { table: 'cfm.billing_lifetime' } },
      async (q) => {
        seen = q;
        return 5_000_000;
      },
    );
    expect(cutoff).toBe(5_000_000);
    expect(seen).toEqual({ table: 'cfm.billing_lifetime', column: 'lifetime_vnd', p: 75, gateSql: undefined });
  });

  it('defaults the column to the member when over.column is absent', async () => {
    let col = '';
    await resolvePercentileCutoff(
      'arppu',
      { p: 50, over: { table: 't' } },
      async (q) => {
        col = q.column;
        return 1;
      },
    );
    expect(col).toBe('arppu');
  });

  it('throws when no population table is given (cutoff would be meaningless)', async () => {
    await expect(
      resolvePercentileCutoff('x', { p: 50 }, async () => 1),
    ).rejects.toThrow(/needs an explicit population table/);
  });

  it('throws on a non-finite cutoff', async () => {
    await expect(
      resolvePercentileCutoff('x', { p: 50, over: { table: 't' } }, async () => NaN),
    ).rejects.toThrow(/non-finite cutoff/);
  });
});
