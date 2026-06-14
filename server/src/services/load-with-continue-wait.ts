/**
 * Cube /load wrapper with transparent "Continue wait" polling.
 *
 * Extracted from refresh-segment so both segments and liveops jobs share the
 * same async-pre-aggregation handling. Cube returns 200 with
 * `{error: "Continue wait"}` while a pre-agg warms; we retry until either it
 * resolves or the deadline elapses.
 */

// Import as namespace so `vi.spyOn(cubeClient, 'load')` is intercepted on each
// call — direct `{ load }` destructuring would capture the unwrapped binding
// at module-load time and bypass the spy on retries.
import * as cubeClient from './cube-client.js';

const CONTINUE_WAIT_RE = /Continue wait/i;
const CONTINUE_WAIT_POLL_MS = 700;

export async function loadWithContinueWait(
  query: unknown,
  tokenOverride: string | undefined,
  timeoutMs: number,
  ctx?: cubeClient.WorkspaceCtx,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Give each fetch the remaining budget rather than the default 15s cap —
    // otherwise a single heavy live query (cold cohort scan inside Cube's 25s
    // continue-wait window) is aborted client-side before Cube can respond,
    // and the whole budget is wasted on a guaranteed timeout.
    const remaining = deadline - Date.now();
    try {
      // Workspace-scoped callers (advisor agent) pass a ctx; legacy server jobs
      // pass a tokenOverride against the global Cube base URL.
      return ctx
        ? await cubeClient.loadWithCtx(query, ctx, Math.max(1, remaining))
        : await cubeClient.load(query, tokenOverride, Math.max(1, remaining));
    } catch (err) {
      const msg = (err as Error).message;
      if (!CONTINUE_WAIT_RE.test(msg)) throw err;
      if (Date.now() >= deadline) {
        throw new Error(
          `${msg} — pre-aggregation still warming after ${timeoutMs}ms`,
        );
      }
      await new Promise((r) =>
        setTimeout(r, Math.min(CONTINUE_WAIT_POLL_MS, deadline - Date.now())),
      );
    }
  }
}
