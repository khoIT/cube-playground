/**
 * Member-360 precompute runner — warms the core (eager) panels for every
 * tiered member of one segment (~150 uids × core panels) into
 * segment_member360_cache, so the member detail page serves from cache instead
 * of fanning live Cube queries per visit. Behavior panels are intentionally
 * NOT precomputed (lazy-on-expand by design, user-locked scope).
 *
 * Load discipline (card-runner posture, tuned for the bigger fan-out):
 * bounded concurrency, per-query timeout, a hard per-segment wall-clock budget
 * with abort-and-resume-next-night, and skip-if-unchanged writes. A
 * budget-skipped unit never overwrites a previously good cache row.
 */

import { createHash } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import { loadWithContinueWait } from './load-with-continue-wait.js';
import { physicalizeQuery, logicalizeRows } from './cube-member-resolver.js';
import { mapWithConcurrency } from './bounded-concurrency.js';
import { resolveGamePrefixForWorkspace } from './resolve-game-prefix.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { corePanelsForGame, type Member360Panel } from './member360-panel-registry.js';
import { buildPanelQuery } from './member360-panel-query.js';
import {
  upsertMember360Cache,
  listOkMember360CacheKeys,
  type Member360CacheEntry,
} from './member360-cache-store.js';
import type { MemberTiers } from '../types/segment.js';

/** Per-query Cube timeout. Sized to outlast a cold warehouse read (several
 *  continue-wait windows). Env: MEMBER360_QUERY_TIMEOUT_MS. */
const PER_QUERY_TIMEOUT_MS = Number(process.env.MEMBER360_QUERY_TIMEOUT_MS) || 120_000;

/** In-flight cap. 150 uids × up to 8 panels is a real fan-out against a shared
 *  dev cube-api; 3 keeps it a slow drip (lessons-learned: pace probes). */
const QUERY_CONCURRENCY = 3;

/** Wall-clock budget for one segment's pass. On expiry, not-yet-started units
 *  short-circuit (and are NOT persisted over good rows); the segment finishes
 *  next nightly window. */
const PER_SEGMENT_BUDGET_MS = 8 * 60_000;

const MAX_ERROR_LEN = 500;
const BUDGET_SKIP_ERROR = 'skipped — precompute budget exceeded';

export interface Member360RunResult {
  segmentId: string;
  uids: number;
  panels: number;
  ok: number;
  error: number;
  budgetSkipped: number;
  elapsedMs: number;
}

interface SegmentRow {
  id: string;
  game_id: string | null;
  workspace: string;
  member_tiers_json: string | null;
}

function hashQuery(q: unknown): string {
  return createHash('sha256').update(JSON.stringify(q)).digest('hex').slice(0, 16);
}

function extractRows(loadResult: unknown): Array<Record<string, unknown>> {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  return r.data ?? r.results?.[0]?.data ?? [];
}

/** All tiered uids in priority order (top → middle → bottom, or `all`),
 *  deduped. This IS the precompute work list — and the prune keep-set. */
export function tieredUids(tiers: MemberTiers): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of ['all', 'top', 'middle', 'bottom'] as const) {
    for (const m of tiers.tiers[name] ?? []) {
      if (!seen.has(m.uid)) {
        seen.add(m.uid);
        out.push(m.uid);
      }
    }
  }
  return out;
}

/** Parse stored tiers JSON; null on absent/corrupt (segment ineligible). */
export function parseTiers(json: string | null): MemberTiers | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as MemberTiers;
    return t && typeof t === 'object' && t.tiers ? t : null;
  } catch {
    return null;
  }
}

/**
 * Precompute one segment's member-360 core panels. Returns null when the
 * segment is missing or ineligible (no tiers / game has no 360 registry).
 * Stamps `member360_last_run_at` on EVERY terminal outcome for an existing
 * segment — including ineligible early returns — so the nightly due-list
 * re-qualifies it next window, not on every 60s tick for the whole window
 * (tiered segments on non-360 games are reachable: the mf_users preset
 * computes tiers for every game, the 360 registry covers only a subset).
 */
export async function precomputeSegmentMembers360(
  segmentId: string,
  budgetMs: number = PER_SEGMENT_BUDGET_MS,
): Promise<Member360RunResult | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT id, game_id, workspace, member_tiers_json FROM segments WHERE id = ?')
    .get(segmentId) as SegmentRow | undefined;
  if (!row) return null;

  const stampLastRun = (): void => {
    db.prepare('UPDATE segments SET member360_last_run_at = ? WHERE id = ?')
      .run(new Date().toISOString(), segmentId);
  };

  const tiers = parseTiers(row.member_tiers_json);
  const panels = corePanelsForGame(row.game_id);
  if (!tiers || panels.length === 0) {
    stampLastRun();
    return null;
  }

  const uids = tieredUids(tiers);
  if (uids.length === 0) {
    stampLastRun();
    return null;
  }

  const token = row.game_id ? resolveCubeTokenForGame(row.game_id) ?? undefined : undefined;
  const prefix = resolveGamePrefixForWorkspace(row.workspace, row.game_id);
  const okKeys = listOkMember360CacheKeys(segmentId);

  const started = Date.now();
  const deadline = started + budgetMs;
  const units: Array<{ uid: string; panel: Member360Panel }> = [];
  for (const uid of uids) {
    for (const panel of panels) units.push({ uid, panel });
  }

  async function runOne({ uid, panel }: { uid: string; panel: Member360Panel }): Promise<Member360CacheEntry | null> {
    // Core panels all key user_id today; identityKey is honored generically so
    // a future clientsdkuserid-keyed core panel still filters the right member.
    const query = buildPanelQuery(panel, [uid]);
    if (!query) return null;
    const physical = physicalizeQuery(query, prefix);
    const queryHash = hashQuery(physical);

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // Budget exhausted. Persist the skip ONLY when the cell has no good row
      // yet (visible "never computed"); never clobber a prior ok row.
      if (okKeys.has(`${uid}|${panel.id}`)) return null;
      return { uid, panelId: panel.id, queryHash, rows: [], status: 'error', error: BUDGET_SKIP_ERROR };
    }

    try {
      const timeout = Math.min(PER_QUERY_TIMEOUT_MS, remaining);
      const raw = await loadWithContinueWait(physical, token, timeout);
      // Logicalize row keys so cached rows match the logical panel members the
      // FE renders by (same contract as card-runner).
      const rows = logicalizeRows(extractRows(raw), prefix);
      return { uid, panelId: panel.id, queryHash, rows, status: 'ok' };
    } catch (err) {
      const message = (err as Error).message?.slice(0, MAX_ERROR_LEN) ?? 'unknown error';
      return { uid, panelId: panel.id, queryHash, rows: [], status: 'error', error: message };
    }
  }

  const results = await mapWithConcurrency(units, QUERY_CONCURRENCY, runOne);
  const entries = results.filter((e): e is Member360CacheEntry => e !== null);
  upsertMember360Cache(segmentId, entries);

  stampLastRun(); // budget-aborted passes resume next window, not next tick

  // Nulls are budget skips over already-ok rows (buildPanelQuery never returns
  // null for a non-empty [uid]); persisted skips carry BUDGET_SKIP_ERROR.
  const budgetSkipped = results.filter((e) => e === null || e.error === BUDGET_SKIP_ERROR).length;
  return {
    segmentId,
    uids: uids.length,
    panels: panels.length,
    ok: entries.filter((e) => e.status === 'ok').length,
    error: entries.filter((e) => e.status === 'error' && e.error !== BUDGET_SKIP_ERROR).length,
    budgetSkipped,
    elapsedMs: Date.now() - started,
  };
}
