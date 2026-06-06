/**
 * Join-path identity inheritance — cubes with no direct identity dimension
 * (e.g. event-level etl_* tables whose `playerid` is a ROLE id, not a user
 * id) inherit the identity field of a cube they can JOIN to (typically the
 * game's mf_users.user_id). The probe is a Cube /sql DRY COMPILE: Cube
 * resolves its join graph at compile time and errors with "Can't find join
 * path" when the cubes are unjoinable — no warehouse query ever executes.
 *
 * This is what makes segment-creation work AUTOMATICALLY for new YAML
 * models: declare a join path (direct or transitive) to the game's
 * user-master cube and the identity map picks it up with zero per-cube
 * configuration. Manual overrides (cube_identity_map) still win in the merge.
 */

import { sql as cubeSql, sqlWithCtx, type WorkspaceCtx } from './cube-client.js';

/** A cube that has a DIRECT identity dimension (from the pattern pass). */
export interface AnchorCube {
  cube: string;
  identityField: string;
  confidence: number;
}

export interface ProbeCubeShape {
  name: string;
  dimensions: Array<{ name: string; type?: string }>;
}

export interface JoinIdentity {
  identityField: string;
  anchorCube: string;
  confidence: number;
}

/** Below direct pattern matches (0.80–0.95) — a join hop is one step removed. */
const JOIN_PROBE_CONFIDENCE = 0.7;
/** Wrong-game anchors fail compile fast, but bound the worst case anyway. */
const MAX_ANCHORS_TRIED = 3;
const CACHE_TTL_MS = 15 * 60 * 1000;

// Compile probes are cheap (~100ms) but /api/identity-map is fetched on every
// Build-page mount — cache per (endpoint, token, cube). The token distinguishes
// per-game minted JWTs on game_id workspaces, so cfm_vn's probe result never
// bleeds into another game's map. Stores the PROMISE so concurrent requests
// during a cold fill dedupe instead of stampeding Cube.
const probeCache = new Map<string, { at: number; result: Promise<JoinIdentity | null> }>();

/** Count of leading '_'-delimited tokens two cube names share (prefix affinity). */
function sharedTokenScore(a: string, b: string): number {
  const at = a.split('_');
  const bt = b.split('_');
  let n = 0;
  while (n < at.length && n < bt.length && at[n] === bt[n]) n += 1;
  return n;
}

/**
 * Order anchors by likelihood for this cube: same game prefix first (so
 * cfm_etl_game_detail tries cfm_mf_users before ballistar_mf_users on prefix
 * workspaces), then the canonical user-master cube, then raw confidence.
 * A wrong anchor just fails compile and the next is tried — ranking is a
 * latency optimisation, not a correctness requirement.
 */
export function rankAnchors(cubeName: string, anchors: AnchorCube[]): AnchorCube[] {
  const mfBoost = (a: AnchorCube) => (a.cube.endsWith('mf_users') ? 1 : 0);
  return [...anchors].sort(
    (x, y) =>
      sharedTokenScore(cubeName, y.cube) - sharedTokenScore(cubeName, x.cube) ||
      mfBoost(y) - mfBoost(x) ||
      y.confidence - x.confidence,
  );
}

/**
 * Minimal query referencing BOTH cubes so Cube must resolve the join path.
 * Event cubes commonly enforce a bounded-time guard at compile time, so when
 * the cube has a time dimension we bound it (`last 7 days` — compile-only,
 * data presence is irrelevant).
 */
export function buildProbeQuery(cube: ProbeCubeShape, anchorField: string): object | null {
  const timeDim = cube.dimensions.find((d) => d.type === 'time');
  if (timeDim) {
    return {
      dimensions: [anchorField],
      timeDimensions: [{ dimension: timeDim.name, dateRange: 'last 7 days' }],
      limit: 1,
    };
  }
  const plainDim = cube.dimensions.find((d) => d.type !== 'time');
  if (plainDim) {
    return { dimensions: [anchorField, plainDim.name], limit: 1 };
  }
  return null; // dimension-less cube — nothing to anchor a probe on
}

async function compiles(query: object, ctx?: WorkspaceCtx): Promise<boolean> {
  try {
    if (ctx) await sqlWithCtx(query, ctx);
    else await cubeSql(query);
    return true;
  } catch {
    // "Can't find join path", guard violations, auth blips — all mean "no
    // automatic identity"; the manual override path remains available.
    return false;
  }
}

async function probeJoinIdentity(
  cube: ProbeCubeShape,
  anchors: AnchorCube[],
  ctx?: WorkspaceCtx,
): Promise<JoinIdentity | null> {
  for (const anchor of rankAnchors(cube.name, anchors).slice(0, MAX_ANCHORS_TRIED)) {
    if (anchor.cube === cube.name) continue;
    const query = buildProbeQuery(cube, anchor.identityField);
    if (!query) return null;
    if (await compiles(query, ctx)) {
      return {
        identityField: anchor.identityField,
        anchorCube: anchor.cube,
        confidence: JOIN_PROBE_CONFIDENCE,
      };
    }
  }
  return null;
}

/** TTL-cached wrapper — the only entry point the suggester should use. */
export function probeJoinIdentityCached(
  cube: ProbeCubeShape,
  anchors: AnchorCube[],
  ctx?: WorkspaceCtx,
): Promise<JoinIdentity | null> {
  const key = `${ctx?.cubeApiUrl ?? 'default'}|${ctx?.token ?? ''}|${cube.name}`;
  const now = Date.now();
  const hit = probeCache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.result;
  const result = probeJoinIdentity(cube, anchors, ctx).catch(() => null);
  probeCache.set(key, { at: now, result });
  return result;
}

/** Test hook — clears the probe cache between cases. */
export function clearJoinProbeCache(): void {
  probeCache.clear();
}
