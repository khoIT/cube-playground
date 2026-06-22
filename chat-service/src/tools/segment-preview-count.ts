/**
 * Propose-time dry-run cohort size. Asks the server's /api/segments/preview-count
 * how many users a candidate predicate matches BEFORE the segment is saved, so
 * the proposal card can show "~N users match" and the user can iterate.
 *
 * Strictly best-effort: a count that is slow, errors, or returns ok:false must
 * NEVER block or delay the proposal. We bound the wait with an AbortController
 * (a cold cohort scan can take many seconds; better to skip the count and show
 * "size on refresh" than to stall the chat turn) and swallow every failure to
 * null, which callers render as the existing estCount:0 path.
 */

import { postJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';
import type { PredicateNode } from '../types/predicate-tree.js';

/** Server-side count budget; the client aborts slightly later as a backstop. */
const SERVER_TIMEOUT_MS = 15_000;
const CLIENT_ABORT_MS = 18_000;

export async function fetchPreviewCount(
  ctx: ToolContext,
  args: { game_id: string; cube: string; predicate_tree: PredicateNode; cube_segments?: string[] },
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_ABORT_MS);
  try {
    const res = await postJson<{ ok: boolean; estCount?: number }>(
      '/api/segments/preview-count',
      {
        game_id: args.game_id,
        cube: args.cube,
        predicate_tree: args.predicate_tree,
        timeout_ms: SERVER_TIMEOUT_MS,
        ...(args.cube_segments ? { cube_segments: args.cube_segments } : {}),
      },
      ctx,
      { signal: controller.signal },
    );
    return res.ok && typeof res.estCount === 'number' ? res.estCount : null;
  } catch (err) {
    // 400 (uncohortable/validation) throws ServerClientError; abort/network throw
    // too. All are non-fatal here — the proposal still emits without a count.
    if (!(err instanceof ServerClientError) && !(err instanceof Error)) return null;
    return null;
  } finally {
    clearTimeout(timer);
  }
}
