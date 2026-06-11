/**
 * On-demand member-profile snapshot for MANUAL segments. Manual segments are
 * explicit uid uploads with no predicate, so the refresh job (which builds
 * profile snapshots for predicate segments) never touches them — without this
 * path the pull API would serve them uid-only rows forever.
 *
 * Small cohorts only (≤ MEMBER_PROFILE_LIMIT): the cohort scope is an
 * identity-IN filter over the stored uid list, which Cube rejects for huge
 * lists (query-text length limit) — the same reason refresh-time card scoping
 * is predicate-only. Computed lazily on the first pull, persisted, then served
 * statically; recomputed when the segment row was updated after the snapshot
 * (uid list replaced/appended).
 *
 * Failure posture: null (caller falls back to uid-only rows), with a short
 * per-segment cooldown so an unreachable Cube can't be hammered through the
 * tokenless route. In-flight calls are deduped per segment.
 */

import { getDb } from '../db/sqlite.js';
import { resolveIdentityField } from './resolve-identity-field.js';
import { resolveGamePrefixForWorkspace } from './resolve-game-prefix.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { logicalCube } from './cube-member-resolver.js';
import { pickPresetForSegment } from '../presets/registry.js';
import { getMetaMemberSets } from './cube-meta-members.js';
import { computeMemberProfiles, MEMBER_PROFILE_LIMIT } from './member-profile-runner.js';
import type { MemberProfiles } from '../types/segment.js';

const FAILURE_COOLDOWN_MS = 60_000;

const inFlight = new Map<string, Promise<MemberProfiles | null>>();
const lastFailureAt = new Map<string, number>();

interface ProfileEligibleRow {
  id: string;
  type: string;
  cube: string | null;
  game_id: string | null;
  workspace: string;
  updated_at?: string | null;
  uid_list_json?: string | null;
  member_profiles_json?: string | null;
}

function parseUids(row: ProfileEligibleRow): string[] {
  try {
    const parsed = JSON.parse(row.uid_list_json ?? '[]');
    return Array.isArray(parsed) ? [...new Set((parsed as string[]).map(String))] : [];
  } catch {
    return [];
  }
}

/** A stored snapshot is current unless the row changed after it was computed
 *  (manual uid lists only change through PATCH/append, which bump updated_at). */
function snapshotCurrent(row: ProfileEligibleRow): boolean {
  if (typeof row.member_profiles_json !== 'string' || !row.member_profiles_json) return false;
  try {
    const parsed = JSON.parse(row.member_profiles_json) as MemberProfiles;
    if (!Array.isArray(parsed?.rows) || parsed.rows.length === 0) return false;
    return !row.updated_at || parsed.computed_at >= row.updated_at;
  } catch {
    return false;
  }
}

/**
 * Compute-and-persist profiles for a manual segment when missing/stale.
 * Returns the snapshot to serve, or null (caller falls back to uid-only).
 */
export async function ensureManualMemberProfiles(
  row: ProfileEligibleRow,
): Promise<MemberProfiles | null> {
  if (row.type !== 'manual' || !row.cube) return null;
  if (snapshotCurrent(row)) {
    return JSON.parse(row.member_profiles_json as string) as MemberProfiles;
  }

  const failedAt = lastFailureAt.get(row.id);
  if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) return null;

  const existing = inFlight.get(row.id);
  if (existing) return existing;

  const job = (async (): Promise<MemberProfiles | null> => {
    const uids = parseUids(row);
    if (uids.length === 0 || uids.length > MEMBER_PROFILE_LIMIT) return null;

    const identityDim = await resolveIdentityField(row.cube as string, row.game_id, {
      workspaceId: row.workspace,
    });
    if (!identityDim) return null;

    const prefix = resolveGamePrefixForWorkspace(row.workspace, row.game_id);
    const preset = pickPresetForSegment(logicalCube(row.cube as string, prefix), null);
    const metaSets = await getMetaMemberSets(row.game_id);
    const token = row.game_id ? resolveCubeTokenForGame(row.game_id) ?? undefined : undefined;

    const profiles = await computeMemberProfiles({
      identityDim,
      // No predicate to mine a defining metric from — the preset LTV ranks.
      rankMeasure: preset?.ltvMeasure ?? null,
      memberColumns: (preset?.memberColumns ?? []) as Array<Record<string, unknown>>,
      metaSets,
      // Cohort scope IS the uploaded list ('equals' over an array = IN).
      segmentFilters: [{ member: identityDim, operator: 'equals', values: uids }],
      totalCount: uids.length,
      tokenOverride: token,
      prefix,
    });
    if (!profiles) return null;

    // Persist WITHOUT bumping updated_at — the snapshot must not look newer
    // than a cohort change that happens one tick later, and updated_at is the
    // staleness clock this module compares against.
    getDb()
      .prepare('UPDATE segments SET member_profiles_json = ? WHERE id = ?')
      .run(JSON.stringify(profiles), row.id);
    return profiles;
  })()
    .catch(() => null)
    .then((result) => {
      inFlight.delete(row.id);
      if (!result) lastFailureAt.set(row.id, Date.now());
      else lastFailureAt.delete(row.id);
      return result;
    });

  inFlight.set(row.id, job);
  return job;
}

/** Test-only reset. */
export function __resetManualProfileState(): void {
  inFlight.clear();
  lastFailureAt.clear();
}
