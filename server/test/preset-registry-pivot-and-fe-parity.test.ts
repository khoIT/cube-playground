import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import {
  presetRegistry,
  pickPresetForCube,
  pickPresetForSegment,
} from '../src/presets/registry.js';
import { etlGameDetailPreset } from '../src/presets/etl-game-detail.js';
import { mfUsersHubPreset } from '../src/presets/mf-users-hub.js';
import type { PresetSpec } from '../src/presets/mf-users-hub.js';

const BUNDLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/presets/bundles');

describe('server preset registry', () => {
  it('resolves etl_game_detail to its curated preset', () => {
    expect(pickPresetForCube('etl_game_detail')).toBe(etlGameDetailPreset);
  });

  it('resolves recharge to its curated preset', () => {
    expect(pickPresetForCube('recharge')?.id).toBe('recharge-events');
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

describe('FE ↔ server preset parity (shared YAML bundles)', () => {
  // Both sides now load the SAME bundles/*.yml (FE inlines at build time via
  // ?raw, server reads at boot), so cache-key/measure parity is guaranteed by
  // construction. What can still break it: a registry entry pointing at a
  // different bundle than the FE registers, or the loader transforming what it
  // parses. These tests pin both: every registered preset must byte-equal its
  // bundle, and every bundle on disk must be registered.
  function cacheKeys(preset: PresetSpec): string[] {
    const keys = preset.headlineKpis.map((k) => `kpi:${k.id}`);
    for (const tab of preset.tabs) {
      keys.push(...tab.kpis.map((k) => `kpi:${tab.id}:${k.id}`));
      keys.push(...tab.cards.map((c) => `card:${tab.id}:${c.id}`));
    }
    return keys;
  }

  const bundleFiles = readdirSync(BUNDLES_DIR).filter((f) => f.endsWith('.yml'));

  it('registers every bundle on disk (no orphan YAML, no extra registration)', () => {
    const bundleIds = bundleFiles
      .map((f) => (yaml.load(readFileSync(join(BUNDLES_DIR, f), 'utf8')) as PresetSpec).id)
      .sort();
    expect(Object.keys(presetRegistry).sort()).toEqual(bundleIds);
  });

  it.each(bundleFiles)('registry preset matches bundle %s verbatim', (file) => {
    const bundle = yaml.load(readFileSync(join(BUNDLES_DIR, file), 'utf8')) as PresetSpec;
    const registered = presetRegistry[bundle.id];
    expect(registered).toBeDefined();
    expect(registered).toEqual(bundle); // loader must not transform
    expect(cacheKeys(registered)).toEqual(cacheKeys(bundle));
  });

  it('every card kind in the bundles is one the card-runner can query', () => {
    const KNOWN = new Set(['line', 'bar', 'composition', 'donut', 'segmented-bar']);
    for (const p of Object.values(presetRegistry)) {
      for (const tab of p.tabs) {
        for (const card of tab.cards) {
          expect(KNOWN.has(card.kind), `${p.id}/${tab.id}/${card.id} kind=${card.kind}`).toBe(true);
        }
      }
    }
  });
});
