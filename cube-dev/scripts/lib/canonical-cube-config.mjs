/**
 * Frozen canonical-cube configuration for the onboarding generator.
 *
 * Source of truth = the cfm cube files under cube/model/cubes/cfm/. cfm is the
 * richest, most complete game; every other game's cubes have drifted to thinner
 * older shapes. The generator copies cfm's canonical files and relabels the
 * game title — bare sql_table values resolve per-tenant in cube.js, so the body
 * is portable verbatim.
 *
 * Scope: 14 portable cubes — the Tier-A/B set MINUS the two etl_ingame_*-sourced
 * cubes (recharge, ordered_funnel_canonical). The raw etl event tables are NOT
 * uniform across games (verified: cfm's etl_ingame_recharge has 26 columns cros
 * lacks), so those cubes reference per-game columns and must be hand-authored.
 * Every game already carries its own recharge.yml. The std, cons, map and mf
 * source tables ARE column-compatible (0 missing names), so their 14 cubes are
 * safely portable. The 20 net-new core-table cubes (role-grain, cons/mf
 * duplicates, net-new marts) are a deferred follow-up and not emitted here.
 */

// JWT game key -> Trino schema (mirrors cube.js GAME_SCHEMA — keep in sync).
export const GAME_SCHEMA = {
  ballistar: 'ballistar_vn',
  cfm: 'cfm_vn',
  cros: 'cros',
  tf: 'tf',
  ptg: 'ptg',
  jus: 'jus_vn',
  muaw: 'muaw',
  pubg: 'pubgm',
};

// Title-label prefix shown in the Data Model view (`<LABEL> — <desc>`).
// Derived from the existing per-game cube titles; the ONLY game-specific token.
export const GAME_LABEL = {
  ballistar: 'Ballistar VN',
  cfm: 'CFM VN',
  cros: 'CROS',
  tf: 'TF',
  ptg: 'PTG',
  jus: 'JUS VN',
  muaw: 'MUAW',
  pubg: 'PUBG Mobile VN',
};

// The label token in the template files (cfm is the template source).
export const TEMPLATE_GAME = 'cfm';
export const TEMPLATE_LABEL = GAME_LABEL[TEMPLATE_GAME];

// The 14 portable canonical cubes + the common-core source table(s) each reads.
// Presence + column-name compatibility of these tables is the clean-emit gate.
export const CANONICAL_CUBES = {
  mf_users: ['mf_users', 'mf_ingame_roles'],
  active_daily: ['std_ingame_user_active_daily'],
  user_recharge_daily: ['std_ingame_user_recharge_daily'],
  game_key_metrics: ['cons_game_key_metrics_daily'],
  new_user_retention: ['cons_game_new_user_retention_daily'],
  retention: ['std_ingame_user_active_daily'],
  marketing_cost: ['std_marketing_cost_all_channels_by_game'],
  user_active_monthly: ['std_ingame_user_active_monthly'],
  user_recharge_monthly: ['std_ingame_user_recharge_monthly'],
  user_roles: ['mf_ingame_roles'],
  user_devices: ['map_ingame_devices_and_userid'],
  user_ips: ['map_ingame_ips_and_userid'],
  user_active_rolling: ['std_ingame_user_active_daily'],
  user_recharge_rolling: ['std_ingame_user_recharge_daily'],
};

// NOT emitted by the generator — etl_ingame_*-sourced, raw tables vary per game.
// Author per-game against that game's own etl columns + identity bridge.
export const BESPOKE_ETL_CUBES = ['recharge', 'ordered_funnel_canonical'];

// Cubes whose shape an anomaly can alter — the generator FLAGS these for an
// agent decision instead of blindly emitting the cfm template.
export const ANOMALY_SENSITIVE = new Set(['mf_users']);

// Thresholds for the data-shape samplers (Phase-04 anomaly detection).
export const DUAL_IDENTITY_AT_RATIO = 0.05; // >5% user_id with '@' suffix => jus-style merge needed
export const HIGH_SCALE_ROWS = 20_000_000; // source rows above which pre-aggs are mandatory day one
