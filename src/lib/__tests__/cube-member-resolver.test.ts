import { describe, it, expect } from 'vitest';
import type { Query } from '@cubejs-client/core';
import {
  resolveGamePrefix,
  physicalMember,
  logicalMember,
  physicalizeQuery,
  logicalizeRows,
} from '../cube-member-resolver';

describe('FE cube-member-resolver', () => {
  describe('resolveGamePrefix', () => {
    it('uses a gamePrefixMap override on a prefix workspace (id ≠ prefix)', () => {
      expect(
        resolveGamePrefix({ gameModel: 'prefix', gamePrefixMap: { cfm_vn: 'cfm' } }, 'cfm_vn'),
      ).toBe('cfm');
    });
    it('defaults an unmapped game to its id (prod names cubes <gameId>_*)', () => {
      expect(resolveGamePrefix({ gameModel: 'prefix', gamePrefixMap: {} }, 'ptg')).toBe('ptg');
      expect(resolveGamePrefix({ gameModel: 'prefix' }, 'nikki')).toBe('nikki');
    });
    it('is null on game_id workspaces, no game, or no workspace', () => {
      expect(resolveGamePrefix({ gameModel: 'game_id' }, 'ballistar')).toBeNull();
      expect(resolveGamePrefix({ gameModel: 'prefix', gamePrefixMap: { ballistar: 'ballistar' } }, null)).toBeNull();
      expect(resolveGamePrefix(null, 'ballistar')).toBeNull();
    });
  });

  describe('null prefix is a strict no-op (game_id / local)', () => {
    it('returns members, queries, rows unchanged', () => {
      expect(physicalMember('mf_users.user_count', null)).toBe('mf_users.user_count');
      expect(logicalMember('mf_users.user_count', null)).toBe('mf_users.user_count');
      const q: Query = { measures: ['mf_users.user_count'] };
      expect(physicalizeQuery(q, null)).toBe(q);
      const rows = [{ 'mf_users.user_count': 5 }];
      expect(logicalizeRows(rows, null)).toBe(rows);
    });
  });

  describe('physicalMember / logicalMember', () => {
    it('prefixes and strips the cube part', () => {
      expect(physicalMember('mf_users.user_count', 'ballistar')).toBe('ballistar_mf_users.user_count');
      expect(logicalMember('ballistar_mf_users.user_count', 'ballistar')).toBe('mf_users.user_count');
    });
    it('is idempotent on the ${prefix}_ boundary', () => {
      expect(physicalMember('ballistar_mf_users.user_count', 'ballistar')).toBe('ballistar_mf_users.user_count');
      expect(logicalMember('mf_users.user_count', 'ballistar')).toBe('mf_users.user_count');
    });
    it('leaves unqualified names alone', () => {
      expect(physicalMember('rawthing', 'ballistar')).toBe('rawthing');
    });
  });

  describe('physicalizeQuery', () => {
    it('rewrites measures, dimensions, timeDimensions, filters (nested), order, segments', () => {
      const q: Query = {
        measures: ['mf_users.user_count'],
        dimensions: ['mf_users.os_platform'],
        timeDimensions: [{ dimension: 'mf_users.install_date', granularity: 'day', dateRange: 'last 90 days' }],
        filters: [
          { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
          { or: [{ member: 'mf_users.payer_tier', operator: 'equals', values: ['whale'] }] },
        ],
        order: { 'mf_users.user_count': 'desc' },
        segments: ['mf_users.active'],
      };
      const out = physicalizeQuery(q, 'ballistar');
      expect(out.measures).toEqual(['ballistar_mf_users.user_count']);
      expect(out.dimensions).toEqual(['ballistar_mf_users.os_platform']);
      expect(out.timeDimensions![0].dimension).toBe('ballistar_mf_users.install_date');
      expect(out.filters![0]).toMatchObject({ member: 'ballistar_mf_users.country' });
      expect((out.filters![1] as { or: Array<{ member: string }> }).or[0].member).toBe('ballistar_mf_users.payer_tier');
      expect(out.order).toEqual({ 'ballistar_mf_users.user_count': 'desc' });
      expect(out.segments).toEqual(['ballistar_mf_users.active']);
    });

    it('leaves already-physical slice filters untouched while prefixing logical measures (idempotent mix)', () => {
      const q: Query = {
        measures: ['mf_users.user_count'],
        filters: [{ member: 'ballistar_recharge.os_platform', operator: 'equals', values: ['iOS'] }],
      };
      const out = physicalizeQuery(q, 'ballistar');
      expect(out.measures).toEqual(['ballistar_mf_users.user_count']);
      expect(out.filters![0]).toMatchObject({ member: 'ballistar_recharge.os_platform' });
    });
  });

  describe('logicalizeRows', () => {
    it('strips the prefix from row keys', () => {
      const rows = [{ 'ballistar_mf_users.user_count': 5, 'ballistar_mf_users.os_platform': 'iOS' }];
      expect(logicalizeRows(rows, 'ballistar')).toEqual([
        { 'mf_users.user_count': 5, 'mf_users.os_platform': 'iOS' },
      ]);
    });
  });
});
