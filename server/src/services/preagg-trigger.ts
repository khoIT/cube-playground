/**
 * On-demand pre-aggregation build trigger (dev/demo affordance).
 *
 * Forcing a build in this prod-mode stack means scoping the refresh worker to
 * one game and recreating it (there is no on-demand build API when
 * CUBEJS_DEV_MODE=false). That is a privileged, stateful operation against a
 * shared container, so it is gated three ways:
 *   - PREAGG_TRIGGER_ENABLED must be 'true' (off by default → prod/CI inert)
 *   - the route is admin-only (router-level requireRole/requireFeature)
 *   - single-flight: only one build runs at a time
 *
 * The work is delegated to cube-dev/scripts/trigger-preagg-build.sh with
 * --restore, so the worker is returned to its all-games hourly config when the
 * build window closes — a one-off build never leaves the shared sweep scoped.
 * This module only spawns that script and tracks its status; the resulting
 * sealed partitions are observed by the normal collector pass.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
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
  /** Last meaningful line of script output (progress / summary). */
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
  return process.env.PREAGG_TRIGGER_ENABLED === 'true';
}

export function getTriggerState(): TriggerState {
  return state;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const MIN_MINUTES = 1;
const MAX_MINUTES = 15;
const DEFAULT_MINUTES = 8;

/** Keep only the last non-empty line of accumulated output for the status feed. */
function lastLine(buf: string): string {
  const lines = buf.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function scriptPath(): string {
  // Host dev server runs from server/, so the repo root is one level up.
  // PREAGG_TRIGGER_SCRIPT overrides for non-standard layouts.
  return (
    process.env.PREAGG_TRIGGER_SCRIPT ||
    resolve(process.cwd(), '..', 'cube-dev/scripts/trigger-preagg-build.sh')
  );
}

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
  if (!isTriggerEnabled()) return { ok: false, error: 'Trigger disabled (set PREAGG_TRIGGER_ENABLED=true on a dev host).' };
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

  // Arg array (not a shell string) — game is also allowlisted above, so no
  // shell-injection surface. --restore returns the worker to all-games on exit.
  const child = spawn(
    'bash',
    [scriptPath(), game, '--minutes', String(mins), '--timer', '20', '--restore'],
    { cwd: resolve(process.cwd(), '..'), env: process.env },
  );

  let buf = '';
  const onData = (d: Buffer) => {
    buf += d.toString();
    const line = lastLine(buf);
    if (line) state.message = line;
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('close', (code) => {
    state.phase = code === 0 ? 'done' : 'error';
    state.exitCode = code;
    state.finishedAt = new Date().toISOString();
    state.message = code === 0 ? `Build window finished for '${game}'.` : `Build script exited ${code}.`;
  });
  child.on('error', (err) => {
    state.phase = 'error';
    state.exitCode = null;
    state.finishedAt = new Date().toISOString();
    state.message = err instanceof Error ? err.message : String(err);
  });

  return { ok: true };
}
