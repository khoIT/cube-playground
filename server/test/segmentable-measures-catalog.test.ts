import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSegmentableMeasures,
  findSegmentableMeasure,
  percentileOverFor,
  isCatalogTarget,
  __resetCatalogCache,
} from '../src/services/segmentable-measures-catalog.js';

beforeEach(() => __resetCatalogCache());

describe('segmentable-measures catalog', () => {
  it('returns cfm_vn spend with the right logical dim, physical column, and payer population', () => {
    const m = findSegmentableMeasure('cfm_vn', 'spend');
    expect(m).toBeTruthy();
    expect(m!.dimension).toBe('mf_users.ltv_vnd');
    expect(m!.physicalTable).toBe('game_integration.cfm_vn.mf_users');
    expect(m!.physicalColumn).toBe('ingame_total_recharge_value_vnd');
    expect(m!.window).toBe('lifetime');
    expect(m!.defaultPopulation).toMatchObject({ member: 'ingame_total_recharge_value_vnd', op: 'gt', values: [0] });
    expect(m!.identityMerge).toBeNull();
  });

  it('exposes the 30d spend variant distinctly from lifetime', () => {
    const m = findSegmentableMeasure('cfm_vn', 'spend_30d');
    expect(m!.dimension).toBe('mf_users.ltv_30d_vnd');
    expect(m!.window).toBe('30d');
  });

  it('flags jus spend as requiring per-user identity merge', () => {
    const m = findSegmentableMeasure('jus_vn', 'spend');
    expect(m!.identityMerge).toMatchObject({ idColumn: 'user_id', transform: 'split_part_at' });
  });

  it('does not payer-scope a non-degenerate concept (active days)', () => {
    const m = findSegmentableMeasure('cfm_vn', 'active_days');
    expect(m!.defaultPopulation).toBeNull();
  });

  it('accepts the bare game id (cfm → cfm_vn) and returns null for unknown concept', () => {
    expect(findSegmentableMeasure('cfm', 'spend')?.dimension).toBe('mf_users.ltv_vnd');
    expect(findSegmentableMeasure('cfm_vn', 'nope')).toBeNull();
    expect(getSegmentableMeasures('not_a_game')).toEqual([]);
  });

  it('percentileOverFor assembles a ready over spec (table/column/filter/merge)', () => {
    const over = percentileOverFor(findSegmentableMeasure('jus_vn', 'spend')!);
    expect(over).toMatchObject({
      table: 'game_integration.jus_vn.mf_users',
      column: 'ingame_total_recharge_value_vnd',
      filter: { op: 'gt', values: [0] },
      identityMerge: { transform: 'split_part_at' },
    });
  });

  it('allowlists only catalogued targets', () => {
    expect(isCatalogTarget('cfm_vn', 'game_integration.cfm_vn.mf_users', 'ingame_total_recharge_value_vnd')).toBe(true);
    expect(isCatalogTarget('cfm_vn', 'game_integration.cfm_vn.mf_users', 'some_other_column')).toBe(false);
    expect(isCatalogTarget('cfm_vn', 'secret.table', 'x')).toBe(false);
  });
});
