/**
 * Cube fetch for VIP profile snapshots, run during a sweep.
 *
 * Two filtered queries (one Trino round-trip each) over the same uid set:
 *   user_profile      → LTV, tier, days-since-active, last-recharge (one row/uid)
 *   user_roles_panel  → display name (many rows/uid → highest-level character)
 *
 * Logical member names are physicalized for prefix workspaces (cfm_user_profile)
 * and the response logicalized back, mirroring the client member-360 path and
 * the server segment/anomaly jobs. Fail-soft per query: a failure yields no
 * rows for that half, never throws, so a missing roles model still persists the
 * profile fields.
 */

import { loadWithCtx, type WorkspaceCtx } from '../services/cube-client.js';
import { physicalizeQuery, logicalizeRows } from '../services/cube-member-resolver.js';
import { resolveGamePrefixForWorkspace } from '../services/resolve-game-prefix.js';
import type { VipProfileSnapshot } from './care-vip-profile-store.js';

// Trino IN-lists get split into per-chunk queries so the whole open-case queue
// is enriched, not just the first slice. CAP is a runaway backstop.
const CHUNK = 500;
const MAX_UIDS = 10_000;

const PROFILE_DIMS = [
  'user_profile.user_id',
  'user_profile.ltv_vnd',
  'user_profile.payer_tier',
  'user_profile.days_since_last_active',
  'user_profile.last_recharge_date',
];

const ROLE_DIMS = [
  'user_roles_panel.user_id',
  'user_roles_panel.last_role_name',
  'user_roles_panel.max_role_level',
];

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type Row = Record<string, unknown>;

/** Run one filtered query, physicalized for the prefix, logicalized on return. */
async function runQuery(
  ctx: WorkspaceCtx,
  prefix: string | null,
  dims: string[],
  idMember: string,
  uids: string[],
): Promise<Row[]> {
  try {
    const query = {
      dimensions: dims,
      filters: [{ member: idMember, operator: 'equals', values: uids }],
      // roles is multi-row per uid; allow headroom over the chunk size.
      limit: CHUNK * 8,
    };
    const res = (await loadWithCtx(physicalizeQuery(query, prefix), ctx)) as { data?: Row[] };
    return logicalizeRows(res.data ?? [], prefix) as Row[];
  } catch {
    return [];
  }
}

/**
 * Build a profile fetcher for one (game, workspace). Returns snapshot rows
 * keyed by uid, merging the role name (highest-level character) onto the
 * profile fields.
 */
export function makeCubeProfileFetcher(
  ctx: WorkspaceCtx,
  gameId: string,
  workspace: string,
): (uids: string[]) => Promise<VipProfileSnapshot[]> {
  return async (uids: string[]): Promise<VipProfileSnapshot[]> => {
    const unique = [...new Set(uids)].slice(0, MAX_UIDS);
    if (unique.length === 0) return [];
    const prefix = resolveGamePrefixForWorkspace(workspace, gameId);

    // Chunk the IN-list so a large queue (thousands of open-case VIPs) is fully
    // enriched. Chunks run sequentially to keep Trino load gentle on a manual sweep.
    const profileRows: Row[] = [];
    const roleRows: Row[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const [p, r] = await Promise.all([
        runQuery(ctx, prefix, PROFILE_DIMS, 'user_profile.user_id', slice),
        runQuery(ctx, prefix, ROLE_DIMS, 'user_roles_panel.user_id', slice),
      ]);
      profileRows.push(...p);
      roleRows.push(...r);
    }

    const byUid = new Map<string, VipProfileSnapshot>();
    for (const r of profileRows) {
      const uid = r['user_profile.user_id'];
      if (uid == null) continue;
      byUid.set(String(uid), {
        uid: String(uid),
        name: null,
        ltvVnd: toNum(r['user_profile.ltv_vnd']),
        tier: r['user_profile.payer_tier'] != null ? String(r['user_profile.payer_tier']) : null,
        daysSinceLastActive: toNum(r['user_profile.days_since_last_active']),
        lastRechargeDate: r['user_profile.last_recharge_date'] != null ? String(r['user_profile.last_recharge_date']) : null,
      });
    }

    // Highest-level character → display name (tie-break on lexically-smaller name
    // so the chosen name is stable across sweeps regardless of row order).
    const bestLevel = new Map<string, number>();
    for (const r of roleRows) {
      const uid = r['user_roles_panel.user_id'];
      const name = r['user_roles_panel.last_role_name'];
      if (uid == null || name == null) continue;
      const key = String(uid);
      const nameStr = String(name);
      const lvl = toNum(r['user_roles_panel.max_role_level']) ?? 0;
      const prev = bestLevel.get(key);
      const take = prev == null || lvl > prev || (lvl === prev && nameStr < (byUid.get(key)?.name ?? '￿'));
      if (take) {
        bestLevel.set(key, lvl);
        const existing = byUid.get(key) ?? {
          uid: key, name: null, ltvVnd: null, tier: null, daysSinceLastActive: null, lastRechargeDate: null,
        };
        byUid.set(key, { ...existing, name: nameStr });
      }
    }

    return [...byUid.values()];
  };
}
