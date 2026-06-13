/**
 * Live member-name resolution for a small, bounded set of uids.
 *
 * The segment refresh stores two artifacts: the FULL membership uid list (bare
 * uids, identity-dimension only — adding a name dim would fan out the per-user
 * row count and corrupt the distinct-count contract), and a ranked profile
 * snapshot enriched with name + LTV but capped at the top MEMBER_PROFILE_LIMIT
 * (1000). Surfaces that show arbitrary members — notably the CS Care watchlist,
 * which lists *contacted* whales who can sit anywhere in the cohort by rank —
 * therefore have no stored name for members below the snapshot cap.
 *
 * This resolves names for exactly the uids being displayed (≤ MAX_LIVE_NAME_UIDS)
 * via one identity-IN Cube query — the same primitive the on-demand profile path
 * uses (`member-profile-on-demand.ts`). Best-effort and fail-soft: any failure
 * returns an empty map and the caller keeps the bare uid. Callers cache their
 * payloads (6h), so this runs at most once per segment per cache window.
 */

import { resolveIdentityField } from './resolve-identity-field.js';
import { resolveGamePrefixForWorkspace } from './resolve-game-prefix.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { logicalCube } from './cube-member-resolver.js';
import { pickPresetForSegment } from '../presets/registry.js';
import { getMetaMemberSets } from './cube-meta-members.js';
import { computeMemberProfiles } from './member-profile-runner.js';
import type { RankFilter } from './segment-rank-measure.js';

/** Display caps elsewhere are ≤50 (watchlist); 60 leaves headroom under Cube's IN-list limit. */
export const MAX_LIVE_NAME_UIDS = 60;
const FAILURE_COOLDOWN_MS = 60_000;
/** A member column / profile column counts as a "name" if its field or key looks name-ish. */
const NAME_COLUMN_RE = /ingame.?name|player.?name|display.?name|name/i;

/** Minimal segment-row shape — a subset of what `guardSegment` already returns. */
export interface NameResolutionRow {
  id: string;
  cube: string | null;
  game_id: string | null;
  workspace: string;
}

/** Per-segment failure clock so an unreachable Cube isn't hammered through this path. */
const lastFailureAt = new Map<string, number>();

function memberColumnIsNameish(col: Record<string, unknown>): boolean {
  const field = typeof col.dimension === 'string' ? col.dimension : typeof col.id === 'string' ? col.id : '';
  return NAME_COLUMN_RE.test(field);
}

/**
 * Resolve uid → in-game name for the given uids. Returns names only for uids the
 * query found with a non-empty value; everything else is absent (caller keeps
 * the uid). Never throws.
 *
 * No in-flight dedupe (unlike the segment-wide on-demand path): each caller
 * passes a different uid set, so a segment-keyed shared promise could hand back a
 * map scoped to the wrong uids. The route-level payload cache already absorbs
 * repeat calls; the cooldown alone guards the failure case.
 */
export async function resolveMemberNamesLive(
  row: NameResolutionRow,
  uids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!row.cube || uids.length === 0) return out;

  const failedAt = lastFailureAt.get(row.id);
  if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) return out;

  const capped = uids.slice(0, MAX_LIVE_NAME_UIDS);
  if (capped.length < uids.length) {
    console.warn(
      `[resolve-member-names-live] ${row.id}: ${uids.length} uids exceeds MAX_LIVE_NAME_UIDS=${MAX_LIVE_NAME_UIDS}; resolving first ${capped.length}.`,
    );
  }

  try {
    const identityDim = await resolveIdentityField(row.cube, row.game_id, { workspaceId: row.workspace });
    if (!identityDim) return out;

    const prefix = resolveGamePrefixForWorkspace(row.workspace, row.game_id);
    const preset = pickPresetForSegment(logicalCube(row.cube, prefix), null);
    const memberColumns = (preset?.memberColumns ?? []) as Array<Record<string, unknown>>;
    // No name-ish column in this game's preset → nothing to resolve; skip the query.
    if (!memberColumns.some(memberColumnIsNameish)) return out;

    const metaSets = await getMetaMemberSets(row.game_id);
    const token = row.game_id ? resolveCubeTokenForGame(row.game_id) ?? undefined : undefined;

    const profiles = await computeMemberProfiles({
      identityDim,
      // No rank — this is a targeted lookup over an explicit uid set, not a top-N.
      rankMeasure: null,
      memberColumns,
      metaSets,
      segmentFilters: [{ member: identityDim, operator: 'equals', values: capped }] as RankFilter[],
      totalCount: capped.length,
      tokenOverride: token,
      prefix,
    });
    if (!profiles) {
      // null = Cube failure OR the name column was dropped by /meta; either way a
      // retry inside the cooldown won't help, so back off briefly.
      lastFailureAt.set(row.id, Date.now());
      return out;
    }

    const nameCol = profiles.columns.find((c) => NAME_COLUMN_RE.test(c.key) || NAME_COLUMN_RE.test(c.field));
    if (!nameCol) return out;
    for (const r of profiles.rows) {
      const name = r[nameCol.key];
      if (name != null && String(name).trim() !== '') out.set(r.uid, String(name));
    }
    lastFailureAt.delete(row.id);
    return out;
  } catch (err) {
    console.warn(`[resolve-member-names-live] ${row.id} failed:`, (err as Error).message);
    lastFailureAt.set(row.id, Date.now());
    return out;
  }
}

/** Test-only reset of the failure clock. */
export function __resetLiveNameState(): void {
  lastFailureAt.clear();
}
