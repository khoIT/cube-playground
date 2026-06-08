/**
 * Per-(game × playbook) data-readiness resolver.
 *
 * A playbook is only as live as the game's data. The resolver checks each
 * playbook's `dataRequirements` against the logical members actually present in
 * that game's Cube /meta, returning one of:
 *
 *   - 'available'   — every required member present and cohort-queryable.
 *   - 'partial'     — modeled but per-member-only (raw etl_* event tables) or
 *                     ops-driven (manual calendar) — drill-down works, no cohort scan.
 *   - 'unavailable' — a required member is absent, or the playbook is blocked on a
 *                     data source no game models. Frontend greys the row, issues NO query.
 *
 * Same registry, different verdict per game: jus returns `unavailable` for all
 * NHÓM 2 (no gameplay model); cfm flips them to `available` once the Phase-4
 * gameplay mart members appear in /meta — with zero registry edits.
 */

import { getMetaWithCtx, type WorkspaceCtx } from '../services/cube-client.js';
import { logicalCube } from '../services/cube-member-resolver.js';
import type { Playbook } from './playbook-registry.js';

export type AvailabilityStatus = 'available' | 'partial' | 'unavailable';

interface MetaCube {
  name: string;
  measures?: { name: string }[];
  dimensions?: { name: string }[];
}
interface MetaResponse {
  cubes?: MetaCube[];
}

/** Raw event tables can't be cohort-scanned on a refresh cadence — per-member only. */
function isRawEventMember(member: string): boolean {
  const cube = member.split('.')[0] ?? '';
  return cube.startsWith('etl_');
}

/**
 * Collect every logical member name (`cube.field`) for ONE game from a /meta
 * response.
 *
 * On a prefix workspace, game-less /meta returns every game's prefixed cubes
 * (`cfm_mf_users`, `jus_mf_users`, …). Unioning them would make a game look
 * `available` for data it cannot query (jus inheriting cfm's gameplay cubes).
 * So when `gamePrefix` is set we include ONLY cubes for that game's prefix and
 * strip exactly that prefix — keeping the verdict strictly per-game.
 *
 * On a game_id workspace (`gamePrefix` null) /meta is already the one game's
 * cubes; members pass through as-is.
 */
export function extractLogicalMembers(meta: unknown, gamePrefix: string | null = null): Set<string> {
  const cubes = (meta as MetaResponse)?.cubes ?? [];
  const out = new Set<string>();
  for (const cube of cubes) {
    if (gamePrefix && !cube.name.startsWith(`${gamePrefix}_`)) continue; // other game's cube
    const cubeName = gamePrefix ? logicalCube(cube.name, gamePrefix) : cube.name;
    for (const m of cube.measures ?? []) {
      const field = m.name.split('.').slice(1).join('.') || m.name;
      out.add(`${cubeName}.${field}`);
    }
    for (const d of cube.dimensions ?? []) {
      const field = d.name.split('.').slice(1).join('.') || d.name;
      out.add(`${cubeName}.${field}`);
    }
  }
  return out;
}

/**
 * Pure resolver — verdict for one playbook against a known member set.
 * Fail-closed: anything not provably present is `unavailable`.
 */
export function resolveAvailability(playbook: Playbook, members: Set<string>): AvailabilityStatus {
  if (playbook.availabilityHints?.blocked) return 'unavailable';
  if (playbook.availabilityHints?.opsDriven) return 'partial';

  const reqs = playbook.dataRequirements;
  // No requirements + not ops-driven shouldn't happen, but treat as available.
  if (reqs.length === 0) return 'available';

  const missing = reqs.some((m) => !members.has(m));
  if (missing) return 'unavailable';

  // All present — downgrade to partial when any requirement is a raw event table.
  if (reqs.some(isRawEventMember)) return 'partial';
  return 'available';
}

// ── Per-game member-set cache ───────────────────────────────────────────────
const TTL_MS = 60_000;
interface CacheEntry {
  members: Set<string>;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();

/**
 * Fetch (and cache) the logical member set for a game's workspace.
 * `cacheKey` should uniquely identify the (workspace × game) pair.
 * Returns an empty set when /meta is unreachable — which fails every playbook
 * closed (never enables on a guess), matching the plan's fail-closed contract.
 */
export async function getGameMembers(
  ctx: WorkspaceCtx,
  gamePrefix: string | null,
  cacheKey: string,
  force = false,
): Promise<Set<string>> {
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (!force && hit && now - hit.fetchedAt < TTL_MS) return hit.members;

  let members = new Set<string>();
  try {
    const meta = await getMetaWithCtx(ctx);
    members = extractLogicalMembers(meta, gamePrefix);
  } catch {
    // Unreachable /meta → empty set → all playbooks unavailable (fail-closed).
    members = new Set<string>();
  }
  cache.set(cacheKey, { members, fetchedAt: Date.now() });
  return members;
}

/** Reset the per-game member cache — used in tests. */
export function resetAvailabilityCache(): void {
  cache.clear();
}
