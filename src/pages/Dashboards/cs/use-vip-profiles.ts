/**
 * use-vip-profiles — batched member-profile enrichment for the VIP action queue.
 *
 * Given the queue's uid set, fires up to two live Cube queries (both filtered
 * by `user_id IN [...]`, so one round-trip each) and merges them by uid:
 *
 *   user_profile  → LTV, VIP level, lifecycle status, days-since-active (churn
 *                   play), last-recharge date (→ derived churn-pay days). One
 *                   row per user.
 *   user_roles_panel → display name. Multiple rows per user (one per character),
 *                   reduced to the highest-level role — the player's main char.
 *
 * Fail-soft: any query error (model unavailable for the game, no Cube creds)
 * degrades to an empty map. The table then renders the uid + dashes rather than
 * an error surface — enrichment is additive, never blocking.
 */

import { useMemo } from 'react';
import type { Query } from '@cubejs-client/core';
import { useMemberCubeQuery } from '../../Segments/member360/use-member-cube-query';

// Queue is bounded by open VIP cases; this cap is a backstop against a runaway
// IN-list. Truncation is surfaced via `truncated` so the UI can note it.
const MAX_UIDS = 300;

export interface VipProfile {
  uid: string;
  /** Main-character display name (highest-level role); null when unknown. */
  name: string | null;
  ltvVnd: number | null;
  vipLevel: number | null;
  /** payer_tier label, e.g. "Diamond" / "Gold"; null when unknown. */
  tier: string | null;
  /** lifecycle_stage, e.g. "active" / "churned". */
  status: string | null;
  /** days_since_last_active. */
  churnPlayDays: number | null;
  /** Derived: whole days since last_recharge_date; null when never recharged. */
  churnPayDays: number | null;
}

export interface VipProfilesResult {
  byUid: Map<string, VipProfile>;
  loading: boolean;
  truncated: boolean;
}

const PROFILE_DIMS = [
  'user_profile.user_id',
  'user_profile.ltv_vnd',
  'user_profile.max_vip_level',
  'user_profile.payer_tier',
  'user_profile.lifecycle_stage',
  'user_profile.days_since_last_active',
  'user_profile.last_recharge_date',
];

const ROLE_DIMS = [
  'user_roles_panel.user_id',
  'user_roles_panel.last_role_name',
  'user_roles_panel.max_role_level',
];

export function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Whole days between `iso` and `now`; null when missing / unparseable. */
export function daysSince(iso: unknown, now: number = Date.now()): number | null {
  if (iso == null) return null;
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * Merge a profile-row set (one per uid) with a role-row set (many per uid) into
 * one VipProfile map. Roles reduce to the highest-level character for the name.
 * Pure — extracted for unit testing of the derive/reduce logic.
 */
export function mergeVipProfiles(
  profileRows: Array<Record<string, unknown>>,
  roleRows: Array<Record<string, unknown>>,
  now: number = Date.now(),
): Map<string, VipProfile> {
  const map = new Map<string, VipProfile>();

  for (const r of profileRows) {
    const uid = r['user_profile.user_id'];
    if (uid == null) continue;
    map.set(String(uid), {
      uid: String(uid),
      name: null,
      ltvVnd: toNum(r['user_profile.ltv_vnd']),
      vipLevel: toNum(r['user_profile.max_vip_level']),
      tier: r['user_profile.payer_tier'] != null ? String(r['user_profile.payer_tier']) : null,
      status: r['user_profile.lifecycle_stage'] != null ? String(r['user_profile.lifecycle_stage']) : null,
      churnPlayDays: toNum(r['user_profile.days_since_last_active']),
      churnPayDays: daysSince(r['user_profile.last_recharge_date'], now),
    });
  }

  // Reduce roles to the highest-level character per uid → display name.
  const bestLevel = new Map<string, number>();
  for (const r of roleRows) {
    const uid = r['user_roles_panel.user_id'];
    const name = r['user_roles_panel.last_role_name'];
    if (uid == null || name == null) continue;
    const key = String(uid);
    const nameStr = String(name);
    const lvl = toNum(r['user_roles_panel.max_role_level']) ?? 0;
    const prevLvl = bestLevel.get(key);
    // Highest-level character wins; on a tie, pick the lexically-smaller name so
    // the chosen name is deterministic across loads (Cube IN-row order is not).
    const take =
      prevLvl == null ||
      lvl > prevLvl ||
      (lvl === prevLvl && nameStr < (map.get(key)?.name ?? '￿'));
    if (take) {
      bestLevel.set(key, lvl);
      const existing = map.get(key) ?? {
        uid: key, name: null, ltvVnd: null, vipLevel: null,
        tier: null, status: null, churnPlayDays: null, churnPayDays: null,
      };
      map.set(key, { ...existing, name: nameStr });
    }
  }

  return map;
}

export function useVipProfiles(gameId: string | null, uids: string[]): VipProfilesResult {
  const truncated = uids.length > MAX_UIDS;
  // Stable, de-duplicated, capped uid set so the query memo doesn't thrash.
  const values = useMemo(() => [...new Set(uids)].slice(0, MAX_UIDS), [uids.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const profileQuery = useMemo<Query | null>(
    () =>
      values.length > 0
        ? {
            dimensions: PROFILE_DIMS,
            filters: [{ member: 'user_profile.user_id', operator: 'equals' as never, values }],
            limit: MAX_UIDS,
          }
        : null,
    [values],
  );

  const roleQuery = useMemo<Query | null>(
    () =>
      values.length > 0
        ? {
            dimensions: ROLE_DIMS,
            filters: [{ member: 'user_roles_panel.user_id', operator: 'equals' as never, values }],
            // A user may own several characters — pull enough to find the main one.
            limit: MAX_UIDS * 8,
          }
        : null,
    [values],
  );

  const { rows: profileRows, loading: profileLoading } =
    useMemberCubeQuery<Record<string, unknown>>(gameId, profileQuery);
  const { rows: roleRows, loading: roleLoading } =
    useMemberCubeQuery<Record<string, unknown>>(gameId, roleQuery);

  const byUid = useMemo(() => mergeVipProfiles(profileRows, roleRows), [profileRows, roleRows]);

  return { byUid, loading: profileLoading || roleLoading, truncated };
}
