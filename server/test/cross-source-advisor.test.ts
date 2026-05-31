/**
 * Unit tests for the cross-source capability advisor (pure — registry caps only).
 * Asserts the engine truth: executable is ALWAYS false; rollupJoin eligibility
 * follows both sources' caps; unknown sources fall back to the ETL note.
 */
import { describe, expect, it } from 'vitest';
import { crossSourceVerdict } from '../src/services/cross-source-advisor.js';

describe('crossSourceVerdict', () => {
  it('is never executable across dataSources', () => {
    expect(crossSourceVerdict('trino', 'postgres').executable).toBe(false);
    expect(crossSourceVerdict('clickhouse', 'bigquery').executable).toBe(false);
  });

  it('marks rollupJoin-eligible when both sources can back a pre-agg', () => {
    const v = crossSourceVerdict('trino', 'postgres'); // both crossSourceRollupJoin: true
    expect(v.rollupJoinEligible).toBe(true);
    expect(v.note).toMatch(/rollupJoin/);
  });

  it('falls back to the ETL path when a source is unknown', () => {
    const v = crossSourceVerdict('trino', 'totally-unknown');
    expect(v.rollupJoinEligible).toBe(false);
    expect(v.note).toMatch(/ETL/);
  });

  it('echoes the two source types', () => {
    const v = crossSourceVerdict('trino', 'clickhouse');
    expect(v.leftSourceType).toBe('trino');
    expect(v.rightSourceType).toBe('clickhouse');
  });
});
