/**
 * Pure env/label transforms for scoping the cube refresh worker to one game.
 *
 * Scoping = recreating the worker with three env overrides:
 *   CUBE_REFRESH_GAMES=<game>           sweep only this game's rollups
 *   CUBEJS_SCHEDULED_REFRESH_TIMER=<s>  fast sweep so the build starts inside
 *                                       a short monitoring window
 *   CUBEJS_LOG_LEVEL=trace              per-partition CREATE TABLE lines are
 *                                       only emitted at trace level — without
 *                                       this the build is invisible to monitors
 *
 * The ORIGINAL values of those three keys are stamped onto the scoped
 * container as a label, so restore works even if the gateway process restarts
 * mid-window and loses its in-memory state: any process can inspect the
 * container, read the label, and rebuild the default env.
 */

/** Label marking a worker as scoped; value = JSON of the original env trio. */
export const SCOPE_LABEL = 'playground.preagg.scoped-original-env';

const SCOPE_KEYS = ['CUBE_REFRESH_GAMES', 'CUBEJS_SCHEDULED_REFRESH_TIMER', 'CUBEJS_LOG_LEVEL'] as const;

type OriginalEnvTrio = Record<(typeof SCOPE_KEYS)[number], string | null>;

function envValue(env: string[], key: string): string | null {
  const prefix = `${key}=`;
  const hit = env.find((e) => e.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}

function withoutScopeKeys(env: string[]): string[] {
  return env.filter((e) => !SCOPE_KEYS.some((k) => e.startsWith(`${k}=`)));
}

export interface ScopedEnvResult {
  /** Full env for the scoped container. */
  env: string[];
  /** JSON to store under SCOPE_LABEL — the pre-scope values of the trio. */
  originalLabelValue: string;
}

/** Build the scoped container's env + the restore label from the current env. */
export function buildScopedEnv(currentEnv: string[], game: string, timerSec: number): ScopedEnvResult {
  const original: OriginalEnvTrio = {
    CUBE_REFRESH_GAMES: envValue(currentEnv, 'CUBE_REFRESH_GAMES'),
    CUBEJS_SCHEDULED_REFRESH_TIMER: envValue(currentEnv, 'CUBEJS_SCHEDULED_REFRESH_TIMER'),
    CUBEJS_LOG_LEVEL: envValue(currentEnv, 'CUBEJS_LOG_LEVEL'),
  };
  return {
    env: [
      ...withoutScopeKeys(currentEnv),
      `CUBE_REFRESH_GAMES=${game}`,
      `CUBEJS_SCHEDULED_REFRESH_TIMER=${timerSec}`,
      'CUBEJS_LOG_LEVEL=trace',
    ],
    originalLabelValue: JSON.stringify(original),
  };
}

/**
 * Rebuild the default (unscoped) env from a scoped container's env + its
 * restore label. Keys whose original value was null are simply dropped.
 * Throws on a malformed label — the caller should surface that rather than
 * recreate a worker with a guessed config.
 */
export function buildRestoredEnv(scopedEnv: string[], labelValue: string): string[] {
  const original = JSON.parse(labelValue) as OriginalEnvTrio;
  const env = withoutScopeKeys(scopedEnv);
  for (const key of SCOPE_KEYS) {
    const val = original[key];
    if (val !== null && val !== undefined) env.push(`${key}=${val}`);
  }
  return env;
}
