/**
 * Cube-relative platform dimension resolution.
 *
 * "X by platform" must bind the platform-family member on the METRIC's cube —
 * os_platform on engagement/revenue cubes, platform on the acquisition cube —
 * not the glossary's lone static `mf_users.platform` ref (which doesn't exist
 * on this game's cube and would trip the /meta gate into a clarify). Member
 * names are identical across all 8 games, so one synthetic meta proves the
 * cross-game behaviour; the prefixed case proves game_id workspaces too.
 */

import { describe, it, expect } from 'vitest';
import {
  matchDimensionSynonym,
  DIMENSION_SYNONYMS,
} from '../../src/nl-to-query/synonym-resolver.js';
import { resolveCubeRelativeDimension } from '../../src/nl-to-query/member-resolution.js';
import { extractSlots } from '../../src/nl-to-query/slot-extractor.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

const PLATFORM = DIMENSION_SYNONYMS.find((s) => s.family === 'platform')!;

function term(p: Partial<OfficialTerm> & { id: string; label: string }): OfficialTerm {
  return {
    description: '',
    primaryCatalogId: null,
    aliases: [],
    aliasesVi: [],
    labelVi: null,
    category: null,
    measureRef: null,
    ratioRef: null,
    refKind: 'measure',
    entityCube: null,
    entityPk: null,
    defaultFilter: null,
    ...p,
  } as OfficialTerm;
}

// Mirrors the live cfm/jus glossary: a `platform` dimension term whose ref is
// the dead `mf_users.platform` (real members are os_platform / platform).
const GLOSSARY: OfficialTerm[] = [
  term({ id: 'active-user', label: 'Active Users', category: 'engagement', aliases: ['dau', 'active users'], measureRef: 'active_daily.dau' }),
  term({ id: 'revenue', label: 'Revenue', category: 'monetisation', aliases: ['revenue'], measureRef: 'user_recharge_daily.revenue_vnd_total' }),
  term({ id: 'roas', label: 'ROAS', category: 'monetisation', aliases: ['roas'], measureRef: 'game_key_metrics.roas' }),
  term({ id: 'platform', label: 'Platform', category: 'dimension', aliases: ['platform', 'device'], refKind: 'unknown', primaryCatalogId: 'mf_users.platform' }),
];

const KNOWN = new Set<string>([
  'active_daily.dau', 'active_daily.os_platform', 'active_daily.country_code',
  'user_recharge_daily.revenue_vnd_total', 'user_recharge_daily.os_platform',
  'game_key_metrics.roas', 'game_key_metrics.platform',
]);

describe('matchDimensionSynonym', () => {
  it('matches platform / device / os as whole words', () => {
    expect(matchDimensionSynonym('DAU by platform last 7 days')?.family).toBe('platform');
    expect(matchDimensionSynonym('split by device')?.family).toBe('platform');
    expect(matchDimensionSynonym('break out by os')?.family).toBe('platform');
  });
  it('does not match inside another word', () => {
    expect(matchDimensionSynonym('show the roster')).toBeNull(); // "os" inside roster
    expect(matchDimensionSynonym('DAU by country')).toBeNull();
  });
});

describe('resolveCubeRelativeDimension', () => {
  it('binds os_platform on an engagement/revenue cube', () => {
    expect(resolveCubeRelativeDimension('active_daily', PLATFORM, KNOWN)).toBe('active_daily.os_platform');
    expect(resolveCubeRelativeDimension('user_recharge_daily', PLATFORM, KNOWN)).toBe('user_recharge_daily.os_platform');
  });
  it('binds bare platform on the acquisition cube', () => {
    expect(resolveCubeRelativeDimension('game_key_metrics', PLATFORM, KNOWN)).toBe('game_key_metrics.platform');
  });
  it('returns null when the cube has no platform member', () => {
    expect(resolveCubeRelativeDimension('recharge', PLATFORM, KNOWN)).toBeNull();
  });
  it('returns null without a known-member set (cannot disambiguate os_platform vs platform)', () => {
    expect(resolveCubeRelativeDimension('active_daily', PLATFORM, undefined)).toBeNull();
  });
});

describe('extractSlots — platform breakdown binds on the metric cube', () => {
  const run = (message: string, knownMembers = KNOWN) =>
    extractSlots({ message, isVietnameseContext: false, now: Date.now(), glossary: GLOSSARY, knownMembers });

  it('DAU by platform → active_daily.os_platform (not mf_users.platform)', () => {
    const d = run('DAU by platform last 7 days').slots.dimension;
    expect(d?.value).toBe('active_daily.os_platform');
  });
  it('revenue by platform → user_recharge_daily.os_platform', () => {
    expect(run('revenue by platform last 7 days').slots.dimension?.value).toBe('user_recharge_daily.os_platform');
  });
  it('ROAS by platform → game_key_metrics.platform', () => {
    expect(run('ROAS by platform last 7 days').slots.dimension?.value).toBe('game_key_metrics.platform');
  });

  it('country breakdown is unaffected (falls through to the glossary path)', () => {
    // No platform synonym → keep the glossary dimension behaviour intact.
    const slots = run('DAU by country last 7 days').slots;
    expect(slots.dimension?.value).not.toBe('active_daily.os_platform');
  });

  it('works on prefixed (game_id workspace) member names too', () => {
    const prefixedGlossary = GLOSSARY.map((t) =>
      t.id === 'active-user' ? { ...t, measureRef: 'cfm_active_daily.dau' } : t,
    );
    const prefixedKnown = new Set(['cfm_active_daily.dau', 'cfm_active_daily.os_platform']);
    const d = extractSlots({
      message: 'DAU by platform last 7 days',
      isVietnameseContext: false,
      now: Date.now(),
      glossary: prefixedGlossary,
      knownMembers: prefixedKnown,
    }).slots.dimension;
    expect(d?.value).toBe('cfm_active_daily.os_platform');
  });
});
