/**
 * Client-side bridge from Cube name → CDP `game_id` + `cdp_source` FQN.
 *
 * In place until cube YAML carries `meta:` natively. FQN values verified
 * against the CDP environment during plan validation Session 1 (2026-05-17).
 * Extend the map when other cubes get their CDP source assigned.
 */

export type CdpMapping = { game_id: string; cdp_source: string };

export const CUBE_TO_CDP_MAPPING: Record<string, CdpMapping> = {
  mf_users: { game_id: 'bal_vn', cdp_source: 'iceberg.ballistar_vn.mf_users' },
};
