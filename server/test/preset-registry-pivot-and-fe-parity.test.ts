import { describe, it, expect } from 'vitest';

import {
  pickPresetForCube,
  pickPresetForSegment,
} from '../src/presets/registry.js';
import { etlGameDetailPreset } from '../src/presets/etl-game-detail.js';
import { mfUsersHubPreset } from '../src/presets/mf-users-hub.js';
// FE mirror — imported across packages purely for spec-parity assertions.
import { etlGameDetailPreset as feEtlGameDetailPreset } from '../../src/pages/Segments/presets/etl-game-detail';

describe('server preset registry', () => {
  it('resolves etl_game_detail to its curated preset', () => {
    expect(pickPresetForCube('etl_game_detail')).toBe(etlGameDetailPreset);
  });

  it('direct hub-cube match wins over the identity anchor', () => {
    expect(pickPresetForSegment('etl_game_detail', 'mf_users')).toBe(etlGameDetailPreset);
  });

  it('pivots a curated-preset-less cube to its identity anchor preset', () => {
    expect(pickPresetForSegment('etl_money_flow', 'mf_users')).toBe(mfUsersHubPreset);
  });

  it('does not pivot to itself or to an anchor without a preset', () => {
    expect(pickPresetForSegment('mf_users', 'mf_users')).toBe(mfUsersHubPreset); // direct
    expect(pickPresetForSegment('etl_money_flow', 'etl_money_flow')).toBeNull();
    expect(pickPresetForSegment('etl_money_flow', 'std_bridge')).toBeNull();
    expect(pickPresetForSegment('etl_money_flow', null)).toBeNull();
  });
});

describe('etl_game_detail FE ↔ server preset parity', () => {
  // The FE hydrates pre-rendered card rows by `kpi:<id>` / `kpi:<tabId>:<id>` /
  // `card:<tabId>:<cardId>` keys produced from the SERVER spec. Any id/measure
  // drift between the two files silently downgrades cards from cache-hydrated
  // to live-fetched (the mf_users preset already drifted this way once).
  function cacheKeys(preset: {
    headlineKpis: Array<{ id: string }>;
    tabs: Array<{ id: string; kpis: Array<{ id: string }>; cards: Array<{ id: string }> }>;
  }): string[] {
    const keys = preset.headlineKpis.map((k) => `kpi:${k.id}`);
    for (const tab of preset.tabs) {
      keys.push(...tab.kpis.map((k) => `kpi:${tab.id}:${k.id}`));
      keys.push(...tab.cards.map((c) => `card:${tab.id}:${c.id}`));
    }
    return keys;
  }

  it('produces identical cache keys', () => {
    expect(cacheKeys(etlGameDetailPreset)).toEqual(cacheKeys(feEtlGameDetailPreset));
  });

  it('queries identical measures per card id', () => {
    const measures = (preset: typeof etlGameDetailPreset) => {
      const out: Record<string, string> = {};
      for (const k of preset.headlineKpis) out[`kpi:${k.id}`] = k.measure;
      for (const tab of preset.tabs) {
        for (const k of tab.kpis) out[`kpi:${tab.id}:${k.id}`] = k.measure;
        for (const c of tab.cards) out[`card:${tab.id}:${c.id}`] = c.measure;
      }
      return out;
    };
    expect(measures(etlGameDetailPreset)).toEqual(
      measures(feEtlGameDetailPreset as unknown as typeof etlGameDetailPreset),
    );
  });
});
