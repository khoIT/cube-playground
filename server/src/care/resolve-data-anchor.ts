/**
 * Per-(game × date-member) "as-of" anchor resolver.
 *
 * Behaviour data in the warehouse lags real time (a feed can be days or weeks
 * behind), and raw event cubes cap any query window at ~31 days. So a sweep that
 * expands `last 7 days` against real today resolves to a window the data never
 * reaches — an empty cohort. This resolver finds the freshest date a given Cube
 * date member actually has, so the sweep can anchor its relative windows there
 * instead of on `now()`. One mechanism unblocks every window-gated playbook.
 *
 * Resolution order (first hit wins):
 *   1. Env override  CARE_DATA_ANCHOR_<GAME>  (e.g. CARE_DATA_ANCHOR_CFM_VN=2026-05-04)
 *   2. Cached detection (TTL ~10 min) for this (cacheKey × member)
 *   3. Live MAX(member) probe via a 1-row descending query
 *   4. Fall back to real today — never throws, so a probe failure can't abort a sweep
 *
 * Anchoring on the SPECIFIC member being windowed (not one fixed mart) keeps a
 * fresh mart on real today while a lagging one resolves to its own last day —
 * each playbook's window binds to where its own data ends.
 */

import { loadWithCtx, type WorkspaceCtx } from '../services/cube-client.js';
import type { PredicateNode } from '../types/predicate-tree.js';

/** Injectable so tests don't need a live Cube. Returns the raw query result. */
export type AnchorLoader = (query: unknown, ctx: WorkspaceCtx) => Promise<unknown>;

interface CacheEntry {
  date: Date;
  fetchedAt: number;
}
const TTL_MS = 10 * 60_000;
const cache = new Map<string, CacheEntry>();

/** Reset the anchor cache — used in tests. */
export function resetDataAnchorCache(): void {
  cache.clear();
}

/**
 * Parse a warehouse date into the anchor Date. A date-only string (`YYYY-MM-DD`,
 * what a Cube date dimension typically returns) is read as LOCAL midnight so it
 * lands on the same calendar day the window expander computes with — the expander
 * uses local-time math, so a UTC-midnight parse would shift the window a day on
 * any negative-UTC-offset host. Full ISO timestamps keep their instant.
 */
function parseAnchorDate(raw: string): Date | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** CARE_DATA_ANCHOR_<GAME> override → a Date, or null when unset/unparseable. */
function envOverride(gameId: string): Date | null {
  const key = `CARE_DATA_ANCHOR_${gameId.toUpperCase()}`;
  const raw = process.env[key];
  if (!raw) return null;
  return parseAnchorDate(raw);
}

/** Pull the first non-null date value out of a /load row set for `member`. */
function firstDate(res: unknown, member: string): Date | null {
  const rows = (res as { data?: Record<string, unknown>[] })?.data ?? [];
  for (const r of rows) {
    const v = r[member];
    if (v == null) continue; // Trino ORDER BY ... DESC defaults NULLS FIRST — skip to the real MAX.
    const d = parseAnchorDate(String(v));
    if (d) return d;
  }
  return null;
}

/**
 * Resolve the as-of anchor for `dateMember` (a `cube.field` time dimension) in
 * `gameId`. `cacheKey` should uniquely identify the (workspace × game) pair.
 * Always resolves to a Date (falls back to today) so callers can log it and a
 * detection failure never aborts the sweep.
 */
export async function resolveDataAnchor(
  ctx: WorkspaceCtx,
  dateMember: string,
  gameId: string,
  cacheKey: string,
  loader: AnchorLoader = loadWithCtx,
): Promise<Date> {
  const override = envOverride(gameId);
  if (override) return override;

  const key = `${cacheKey}::${dateMember}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < TTL_MS) return hit.date;

  let resolved: Date | null = null;
  try {
    // MAX(member): one row, member descending. Cheap on a date dimension.
    const res = await loader(
      { dimensions: [dateMember], order: { [dateMember]: 'desc' }, limit: 1 },
      ctx,
    );
    resolved = firstDate(res, dateMember);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[care] data-anchor probe failed for ${dateMember} (${gameId}); falling back to today:`,
      err instanceof Error ? err.message : err,
    );
  }

  const date = resolved ?? new Date();
  if (resolved) cache.set(key, { date, fetchedAt: Date.now() });
  return date;
}

/**
 * Find the date member a predicate windows on — the first `inDateRange` leaf's
 * member. Returns null when the predicate has no relative-date window (abs/tier
 * playbooks), so the caller skips the anchor probe entirely.
 */
export function findWindowedDateMember(node: PredicateNode): string | null {
  if (node.kind === 'leaf') {
    return node.op === 'inDateRange' ? node.member : null;
  }
  for (const child of node.children) {
    const m = findWindowedDateMember(child);
    if (m) return m;
  }
  return null;
}
