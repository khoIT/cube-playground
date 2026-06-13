/**
 * On-demand pre-aggregation build trigger.
 *
 * Forcing a build in this prod-mode stack means scoping the refresh worker to
 * one game and recreating it (there is no on-demand build API when
 * CUBEJS_DEV_MODE=false; scheduled refresh is the only thing that seals).
 * The scope → monitor → restore dance runs IN-PROCESS against the Docker
 * Engine API over the socket — the same socket the sweep collector reads —
 * so it works identically on a dev host and inside the prod gateway
 * container, where no docker CLI, compose binary, or repo checkout exists.
 * (cube-dev/scripts/trigger-preagg-build.sh remains the manual-CLI
 * equivalent for host shells.)
 *
 * Recreating a shared container is privileged and stateful, so it is gated:
 *   - admin-only route (router-level requireRole/requireFeature)
 *   - single-flight: only one build runs at a time
 *   - PREAGG_TRIGGER_ENABLED=false opts an env out (ON by default — the
 *     route gating already restricts it to admins, and a missing docker
 *     socket just makes a start attempt fail with a clear message)
 *
 * Crash-safety: the worker's pre-scope env is stamped onto the scoped
 * container as a label (see preagg-worker-scope-env.ts), and boot calls
 * restoreLeftoverScopedWorker() — so a gateway restart mid-window can never
 * leave the shared worker permanently scoped to one game at a 20s trace sweep.
 */

import {
  inspectContainer,
  recreateContainerWithEnv,
  type ContainerInspect,
} from './docker-container-control.js';
import { buildScopedEnv, buildRestoredEnv, SCOPE_LABEL } from './preagg-worker-scope-env.js';
import { readWorkerLogsSince } from './docker-log-reader.js';
import { writeBuildLogSnapshot } from './preagg-build-log-snapshot-ingest.js';
import { recordTriggeredBuild } from './preagg-triggered-build-record.js';
import { getDb } from '../db/sqlite.js';
import { isKnownGame } from './games-config-loader.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type TriggerPhase = 'idle' | 'running' | 'done' | 'error';

export interface TriggerState {
  phase: TriggerPhase;
  game: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Last meaningful progress / summary line. */
  message: string | null;
  exitCode: number | null;
}

let state: TriggerState = {
  phase: 'idle',
  game: null,
  startedAt: null,
  finishedAt: null,
  message: null,
  exitCode: null,
};

export function isTriggerEnabled(): boolean {
  return process.env.PREAGG_TRIGGER_ENABLED !== 'false';
}

export function getTriggerState(): TriggerState {
  return state;
}

function workerContainerName(): string {
  return process.env.PREAGG_WORKER_CONTAINER ?? 'cube-playground-cube-refresh-worker-dev';
}

// ---------------------------------------------------------------------------
// Build-window monitoring (mirrors trigger-preagg-build.sh's log grep)
// ---------------------------------------------------------------------------

const MIN_MINUTES = 1;
const MAX_MINUTES = 15;
const DEFAULT_MINUTES = 8;
/** Scoped sweep interval — the worker's normal 300s never fires in-window. */
const SCOPED_TIMER_SEC = 20;
const POLL_MS = 30_000;
/** Consecutive no-new-attempts polls (×30s) after activity → finish early. */
const QUIET_POLLS = 3;

const CREATE_TABLE_RE = /CREATE TABLE preagg_[a-z0-9]+\./g;
const ERR_SIGS_RE = /after it was successfully created|later than self|must be a time or timestamp/g;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Snapshot the worker's logs for the collector; never throws. */
async function snapshotWorkerLogs(container: string, sinceUnix: number, game: string, label: string): Promise<void> {
  try {
    writeBuildLogSnapshot(await readWorkerLogsSince(container, sinceUnix), game, label);
  } catch {
    // socket hiccup — the collector just misses these lines.
  }
}

async function monitorBuildWindow(container: string, sinceUnix: number, minutes: number): Promise<string> {
  const deadline = Date.now() + minutes * 60_000;
  let lastAttempts = 0;
  let quiet = 0;
  let errors = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let logs: string[] = [];
    try {
      logs = await readWorkerLogsSince(container, sinceUnix);
    } catch {
      // transient read failure — keep the window open and retry next poll.
    }
    const text = logs.join('\n');
    const attempts = (text.match(CREATE_TABLE_RE) ?? []).length;
    errors = (text.match(ERR_SIGS_RE) ?? []).length;
    const elapsed = Math.round((Date.now() - (deadline - minutes * 60_000)) / 1000);
    state.message = `+${elapsed}s build-attempts=${attempts} errors=${errors}`;

    if (attempts === lastAttempts && attempts > 0) {
      quiet += 1;
      if (quiet >= QUIET_POLLS) return `builds quiet after ${attempts} attempts (${errors} errors)`;
    } else {
      quiet = 0;
    }
    lastAttempts = attempts;
  }
  return `window closed: ${lastAttempts} build attempts (${errors} errors)`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export interface StartResult {
  ok: boolean;
  error?: string;
}

/**
 * Kick a scoped build for one game in the background. Returns immediately;
 * progress is polled via getTriggerState(). Rejects when disabled, when the
 * game is unknown, or when a build is already running (single-flight).
 */
export function startTrigger(game: string, minutes = DEFAULT_MINUTES): StartResult {
  if (!isTriggerEnabled()) return { ok: false, error: 'Trigger disabled (PREAGG_TRIGGER_ENABLED=false on this host).' };
  if (state.phase === 'running') return { ok: false, error: `A build for '${state.game}' is already running.` };
  if (!isKnownGame(game)) return { ok: false, error: `Unknown game '${game}'.` };

  const mins = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.floor(minutes) || DEFAULT_MINUTES));

  state = {
    phase: 'running',
    game,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: 'scoping worker + starting build…',
    exitCode: null,
  };

  void runBuildWindow(game, mins);
  return { ok: true };
}

async function runBuildWindow(game: string, minutes: number): Promise<void> {
  const container = workerContainerName();
  const scopeStartUnix = Math.floor(Date.now() / 1000);
  let scoped = false;
  let summary = '';

  try {
    // The outgoing all-games container may hold sweep logs the collector's
    // 5-min cadence hasn't ingested yet — preserve the recent tail before the
    // recreate wipes it.
    await snapshotWorkerLogs(container, scopeStartUnix - 15 * 60, game, 'prescope');

    const info = await inspectContainer(container);
    const { env, originalLabelValue } = buildScopedEnv(info.Config.Env, game, SCOPED_TIMER_SEC);
    await recreateContainerWithEnv(container, info, env, {
      ...info.Config.Labels,
      [SCOPE_LABEL]: originalLabelValue,
    });
    scoped = true;
    state.message = `worker scoped to ${game}; sweeping every ${SCOPED_TIMER_SEC}s — monitoring up to ${minutes}m`;

    summary = await monitorBuildWindow(container, scopeStartUnix, minutes);

    state.phase = 'done';
    state.exitCode = 0;
    state.message = `Build window finished for '${game}': ${summary}`;
  } catch (err) {
    state.phase = 'error';
    state.exitCode = null;
    state.message = err instanceof Error ? err.message : String(err);
  } finally {
    state.finishedAt = new Date().toISOString();
    if (scoped) {
      // The scoped container's full history IS the build window. Read it ONCE
      // before the restore-recreate wipes it, and record a durable history row
      // directly — this owns the build window (no collector-cadence wait, and no
      // fragmentary scheduled rows from the scoped 20s sweep intervals). On a
      // degraded read we get no lines → skip recording rather than write a
      // false "nothing built".
      let windowLines: string[] | null = null;
      try {
        windowLines = await readWorkerLogsSince(container, scopeStartUnix);
      } catch {
        // socket hiccup — the build still ran; we just can't record its stats.
      }
      if (windowLines && windowLines.length > 0) {
        recordTriggeredBuild(getDb(), {
          game,
          startedAt: state.startedAt ?? new Date(scopeStartUnix * 1000).toISOString(),
          finishedAt: state.finishedAt,
          lines: windowLines,
        });
      }
      try {
        await restoreWorker(container);
      } catch (err) {
        state.phase = 'error';
        state.exitCode = null;
        state.message = `build window ran (${summary || 'no summary'}) but restoring the worker failed: ${
          err instanceof Error ? err.message : String(err)
        } — it is still scoped to '${game}'; boot recovery or a redeploy will restore it`;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** Recreate the worker with its pre-scope env, read from the scope label. */
async function restoreWorker(container: string): Promise<boolean> {
  const info = await inspectContainer(container);
  const labelValue = info.Config.Labels?.[SCOPE_LABEL];
  if (!labelValue) return false; // not scoped — nothing to do
  const env = buildRestoredEnv(info.Config.Env, labelValue);
  const labels = { ...info.Config.Labels };
  delete labels[SCOPE_LABEL];
  await recreateContainerWithEnv(container, info, env, labels);
  return true;
}

/**
 * Boot-time recovery: if a previous gateway died mid-build-window, the worker
 * is still scoped (its scope label survives the crash). Restore it so the
 * shared hourly all-games sweep resumes. Never throws.
 */
export async function restoreLeftoverScopedWorker(log: (msg: string) => void): Promise<void> {
  if (!isTriggerEnabled()) return;
  const container = workerContainerName();
  try {
    if (await restoreWorker(container)) {
      log(`preagg-trigger: restored '${container}' from a leftover scoped state (previous gateway died mid-build-window)`);
    }
  } catch {
    // No socket / no container on this host — nothing to recover.
  }
}
