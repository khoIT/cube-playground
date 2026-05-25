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
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await cubeClient.load(query, tokenOverride);
    } catch (err) {
      const msg = (err as Error).message;
      if (!CONTINUE_WAIT_RE.test(msg)) throw err;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `${msg} — pre-aggregation still warming after ${timeoutMs}ms`,
        );
      }
      await new Promise((r) =>
        setTimeout(r, Math.min(CONTINUE_WAIT_POLL_MS, remaining)),
      );
    }
  }
}
