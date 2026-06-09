/**
 * Per-cube data-freshness resolution for the CS care surfaces.
 *
 * Covers: time-dimension discovery from /meta (prefers `log_date`, strips the
 * game prefix), parallel MAX-probe resolution to local `YYYY-MM-DD`, that a cube
 * with no time dimension is omitted, and the prefix-workspace filter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractCubeTimeDimensions,
  resolveCubeFreshness,
} from '../src/care/data-freshness.js';
import { resetDataAnchorCache, type AnchorLoader } from '../src/care/resolve-data-anchor.js';
import type { WorkspaceCtx } from '../src/services/cube-client.js';

const CTX: WorkspaceCtx = { cubeApiUrl: 'http://stub', token: null };

/** Bare (game_id workspace) /meta: cubes already logical, no prefix. */
const BARE_META = {
  cubes: [
    {
      name: 'user_gameplay_daily',
      dimensions: [
        { name: 'user_gameplay_daily.user_id', type: 'string' },
        { name: 'user_gameplay_daily.clan_changed_at', type: 'time' },
        { name: 'user_gameplay_daily.log_date', type: 'time' }, // preferred over clan_changed_at
      ],
    },
    {
      name: 'mf_users',
      dimensions: [
        { name: 'mf_users.user_id', type: 'string' },
        { name: 'mf_users.log_date', type: 'time' },
      ],
    },
    {
      name: 'lookup_only', // no time dimension → omitted
      dimensions: [{ name: 'lookup_only.code', type: 'string' }],
    },
  ],
};

beforeEach(() => {
  resetDataAnchorCache();
});

describe('extractCubeTimeDimensions', () => {
  it('prefers a log_date field and omits cubes with no time dimension', () => {
    const map = extractCubeTimeDimensions(BARE_META);
    expect(map.get('user_gameplay_daily')).toBe('user_gameplay_daily.log_date');
    expect(map.get('mf_users')).toBe('mf_users.log_date');
    expect(map.has('lookup_only')).toBe(false);
  });

  it('on a prefix workspace keeps only that game and strips the prefix', () => {
    const prefixed = {
      cubes: [
        { name: 'cfm_user_gameplay_daily', dimensions: [{ name: 'cfm_user_gameplay_daily.log_date', type: 'time' }] },
        { name: 'jus_mf_users', dimensions: [{ name: 'jus_mf_users.log_date', type: 'time' }] },
      ],
    };
    const map = extractCubeTimeDimensions(prefixed, 'cfm');
    expect(map.get('user_gameplay_daily')).toBe('user_gameplay_daily.log_date');
    expect(map.has('mf_users')).toBe(false); // jus_ cube excluded
  });
});

describe('resolveCubeFreshness', () => {
  /** Loader that answers MAX(member) per cube — gameplay lags, mf_users is fresh. */
  const loader: AnchorLoader = async (query) => {
    const member = (query as { dimensions: string[] }).dimensions[0];
    const byMember: Record<string, string> = {
      'user_gameplay_daily.log_date': '2026-05-01',
      'mf_users.log_date': '2026-06-09',
    };
    const v = byMember[member];
    return { data: v ? [{ [member]: v }] : [] };
  };

  it('resolves each backing cube to its local YYYY-MM-DD as-of date', async () => {
    const out = await resolveCubeFreshness(
      CTX,
      BARE_META,
      null,
      'cfm_vn',
      'local:cfm_vn',
      ['user_gameplay_daily', 'mf_users'],
      loader,
    );
    expect(out).toEqual({
      user_gameplay_daily: '2026-05-01',
      mf_users: '2026-06-09',
    });
  });

  it('probes the PHYSICAL member on a prefix workspace, keyed by the logical cube', async () => {
    const prefixedMeta = {
      cubes: [
        {
          name: 'cfm_user_gameplay_daily',
          dimensions: [{ name: 'cfm_user_gameplay_daily.log_date', type: 'time' }],
        },
      ],
    };
    const seen: string[] = [];
    const recordingLoader: AnchorLoader = async (query) => {
      const member = (query as { dimensions: string[] }).dimensions[0];
      seen.push(member);
      return { data: [{ [member]: '2026-05-01' }] };
    };
    const out = await resolveCubeFreshness(
      CTX,
      prefixedMeta,
      'cfm',
      'cfm_vn',
      'prod:cfm_vn',
      ['user_gameplay_daily'],
      recordingLoader,
    );
    // Output keyed by the logical cube (matches registry dataRequirements)…
    expect(out).toEqual({ user_gameplay_daily: '2026-05-01' });
    // …but the MAX probe queried the PHYSICAL member the prod Cube exposes.
    expect(seen).toEqual(['cfm_user_gameplay_daily.log_date']);
  });

  it('skips cubes absent from /meta or lacking a time dimension', async () => {
    const out = await resolveCubeFreshness(
      CTX,
      BARE_META,
      null,
      'cfm_vn',
      'local:cfm_vn',
      ['lookup_only', 'nonexistent_cube', 'mf_users'],
      loader,
    );
    expect(out).toEqual({ mf_users: '2026-06-09' });
  });
});
