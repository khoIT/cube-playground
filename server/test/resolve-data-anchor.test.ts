/**
 * Data-anchor resolution + windowed-member detection.
 *
 * The anchor lets a sweep over lagging warehouse data bind its relative windows
 * to the freshest day the data actually has, instead of an empty future range.
 * These cover: env override wins, live MAX probe, fail-safe to today, caching,
 * and that abs/tier predicates (no date window) skip the probe.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveDataAnchor,
  findWindowedDateMember,
  resetDataAnchorCache,
  type AnchorLoader,
} from '../src/care/resolve-data-anchor.js';
import type { PredicateNode } from '../src/types/predicate-tree.js';
import type { WorkspaceCtx } from '../src/services/cube-client.js';

const CTX: WorkspaceCtx = { cubeApiUrl: 'http://stub', token: null };
const MEMBER = 'user_recharge_daily.log_date';

/** Loader that returns one descending row, recording how many times it ran. */
function stubLoader(date: string | null): { loader: AnchorLoader; calls: () => number } {
  let calls = 0;
  const loader: AnchorLoader = async () => {
    calls += 1;
    return { data: date == null ? [] : [{ [MEMBER]: date }] };
  };
  return { loader, calls: () => calls };
}

beforeEach(() => {
  resetDataAnchorCache();
  delete process.env.CARE_DATA_ANCHOR_CFM_VN;
});

describe('resolveDataAnchor', () => {
  it('uses the live MAX(member) probe result as the anchor', async () => {
    const { loader } = stubLoader('2026-05-04T00:00:00.000Z');
    const d = await resolveDataAnchor(CTX, MEMBER, 'cfm_vn', 'local:cfm_vn', loader);
    expect(d.toISOString()).toBe('2026-05-04T00:00:00.000Z');
  });

  it('env override CARE_DATA_ANCHOR_<GAME> wins and skips the probe', async () => {
    process.env.CARE_DATA_ANCHOR_CFM_VN = '2026-05-01';
    const { loader, calls } = stubLoader('2026-05-04T00:00:00.000Z');
    const d = await resolveDataAnchor(CTX, MEMBER, 'cfm_vn', 'local:cfm_vn', loader);
    // Date-only override parses to LOCAL midnight (matches the window expander's
    // local-time math), so assert on local calendar components, not UTC.
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 5, 1]);
    expect(calls()).toBe(0); // probe never ran
  });

  it('falls back to ~today when the probe returns no rows (never throws)', async () => {
    const { loader } = stubLoader(null);
    const before = Date.now();
    const d = await resolveDataAnchor(CTX, MEMBER, 'cfm_vn', 'local:cfm_vn', loader);
    expect(d.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('falls back to ~today when the probe throws (a failed probe must not abort a sweep)', async () => {
    const loader: AnchorLoader = async () => {
      throw new Error('cube down');
    };
    const before = Date.now();
    const d = await resolveDataAnchor(CTX, MEMBER, 'cfm_vn', 'local:cfm_vn', loader);
    expect(d.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('caches a resolved anchor (second call within TTL does not re-probe)', async () => {
    const { loader, calls } = stubLoader('2026-05-04T00:00:00.000Z');
    await resolveDataAnchor(CTX, MEMBER, 'cfm_vn', 'local:cfm_vn', loader);
    await resolveDataAnchor(CTX, MEMBER, 'cfm_vn', 'local:cfm_vn', loader);
    expect(calls()).toBe(1);
  });
});

describe('findWindowedDateMember', () => {
  it('returns the inDateRange leaf member nested inside an AND group', () => {
    const tree: PredicateNode = {
      kind: 'group',
      id: 'g',
      op: 'AND',
      children: [
        { kind: 'leaf', id: 'a', member: 'mf_users.ltv_total_vnd', type: 'number', op: 'gte', values: [1] },
        { kind: 'leaf', id: 'b', member: 'etl_prop_flow.acquired_at', type: 'time', op: 'inDateRange', values: ['last 7 days'] },
      ],
    };
    expect(findWindowedDateMember(tree)).toBe('etl_prop_flow.acquired_at');
  });

  it('returns null for an abs/tier predicate with no date window', () => {
    const tree: PredicateNode = {
      kind: 'leaf',
      id: 'a',
      member: 'mf_users.ltv_total_vnd',
      type: 'number',
      op: 'gte',
      values: [5_000_000],
    };
    expect(findWindowedDateMember(tree)).toBeNull();
  });
});
