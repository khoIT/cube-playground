-- Contact-governance config for VIP care: per-game caps + per-channel cooldowns
-- so a VIP matching many playbooks isn't spammed. One row per game; absent row =
-- the conservative defaults applied in code (1 proactive outreach / VIP / 24h +
-- per-channel cooldowns call 7d · Zalo ZNS 48h · in-game/push 24h).
--
-- Additive + forward-only (runner keys off PRAGMA user_version = file count).

CREATE TABLE IF NOT EXISTS care_governance (
  game_id TEXT PRIMARY KEY,
  max_contacts_per_window INTEGER NOT NULL,
  window_hours INTEGER NOT NULL,
  per_channel_cooldown_json TEXT NOT NULL,  -- { call, zalo_zns, in_game, push } cooldown hours
  updated_at TEXT NOT NULL
);
