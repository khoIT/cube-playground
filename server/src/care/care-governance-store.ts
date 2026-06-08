/**
 * Per-game contact-governance config (caps + per-channel cooldowns).
 * Absent row → conservative defaults below, so governance is enforced even
 * before anyone tunes it for a game.
 */

import { getDb } from '../db/sqlite.js';

export type CareChannel = 'call' | 'zalo_zns' | 'in_game' | 'push';

export interface GovernanceConfig {
  gameId: string;
  maxContactsPerWindow: number;
  windowHours: number;
  perChannelCooldownHours: Record<CareChannel, number>;
}

/** Resolved decision: 1 proactive outreach / VIP / 24h + per-channel cooldowns. */
export const DEFAULT_GOVERNANCE: Omit<GovernanceConfig, 'gameId'> = {
  maxContactsPerWindow: 1,
  windowHours: 24,
  perChannelCooldownHours: { call: 168, zalo_zns: 48, in_game: 24, push: 24 },
};

interface Row {
  game_id: string;
  max_contacts_per_window: number;
  window_hours: number;
  per_channel_cooldown_json: string;
  updated_at: string;
}

export function getGovernance(gameId: string): GovernanceConfig {
  const row = getDb().prepare('SELECT * FROM care_governance WHERE game_id = ?').get(gameId) as
    | Row
    | undefined;
  if (!row) return { gameId, ...DEFAULT_GOVERNANCE };
  let cooldowns = DEFAULT_GOVERNANCE.perChannelCooldownHours;
  try {
    cooldowns = { ...cooldowns, ...JSON.parse(row.per_channel_cooldown_json) };
  } catch {
    // Corrupt config → fall back to defaults rather than failing the queue.
    console.warn(`[care-governance] unparseable cooldown json for ${gameId} — using defaults`);
  }
  return {
    gameId,
    maxContactsPerWindow: row.max_contacts_per_window,
    windowHours: row.window_hours,
    perChannelCooldownHours: cooldowns,
  };
}

export function upsertGovernance(cfg: GovernanceConfig): GovernanceConfig {
  getDb()
    .prepare(
      `INSERT INTO care_governance
         (game_id, max_contacts_per_window, window_hours, per_channel_cooldown_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET
         max_contacts_per_window = excluded.max_contacts_per_window,
         window_hours = excluded.window_hours,
         per_channel_cooldown_json = excluded.per_channel_cooldown_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      cfg.gameId,
      cfg.maxContactsPerWindow,
      cfg.windowHours,
      JSON.stringify(cfg.perChannelCooldownHours),
      new Date().toISOString(),
    );
  return getGovernance(cfg.gameId);
}
