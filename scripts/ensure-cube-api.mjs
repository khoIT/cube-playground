#!/usr/bin/env node
/**
 * Boot guard + watchdog for the external Cube backend.
 *
 * One-shot mode (no flag): probes /livez once, recovers if needed, then exits.
 * Wired into `dev:all` so vite/server/chat start with a live cube_api.
 *
 * Watch mode (--watch): keeps polling /livez every WATCH_INTERVAL_MS and
 * triggers recovery on N consecutive failures. A cooldown prevents thrash if
 * cube_api can't recover. Run alongside the dev processes via concurrently.
 *
 * Recovery strategy: if TCP accepts but HTTP hangs (observed mode: container
 * "Up" but stuck), `docker compose restart cube_api` clears it. If the
 * container is down, `docker compose up -d` starts it.
 *
 * Env overrides:
 *   CUBE_API_URL   default http://localhost:4000
 *   CUBE_DEV_PATH  default ~/Documents/code/cube-dev
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const CUBE_API_URL = process.env.CUBE_API_URL ?? 'http://localhost:4000';
const CUBE_DEV_PATH = process.env.CUBE_DEV_PATH ?? resolve(homedir(), 'Documents/code/cube-dev');
const PROBE_TIMEOUT_MS = 8000;
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2000;
// Watch-mode tunables. Five consecutive misses (≈2.5min) before a restart so a
// slow pre-aggregation build doesn't trigger a kick. Cooldown stops thrash if
// cube_api can't recover on its own (e.g. bad config).
const WATCH_INTERVAL_MS = 30_000;
const WATCH_FAILURE_THRESHOLD = 5;
const WATCH_COOLDOWN_MS = 5 * 60_000;
// One last, very patient probe right before restarting. A cube_api that is
// busy building a pre-aggregation (common under dev mode / emulation) blocks
// /livez for a while without the process being dead — restarting it there just
// discards the partial build and guarantees the next query rebuilds from
// scratch. If this generous probe answers, it was busy, not down: skip.
const GRACE_PROBE_TIMEOUT_MS = 25_000;

const log = (msg) => process.stdout.write(`[cube-guard] ${msg}\n`);
const warn = (msg) => process.stderr.write(`[cube-guard] ${msg}\n`);

async function probe(timeoutMs = PROBE_TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${CUBE_API_URL}/livez`, { signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function docker(args, { capture = false } = {}) {
  return spawnSync('docker', args, {
    cwd: CUBE_DEV_PATH,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
}

function containerRunning() {
  const r = docker(['compose', 'ps', '--status', 'running', '--services'], { capture: true });
  if (r.status !== 0) return false;
  return r.stdout.split('\n').some((s) => s.trim() === 'cube_api');
}

async function recoverOnce() {
  if (!existsSync(CUBE_DEV_PATH)) {
    warn(`cube-dev repo not found at ${CUBE_DEV_PATH}. Set CUBE_DEV_PATH or start cube manually.`);
    return false;
  }
  if (spawnSync('docker', ['--version'], { stdio: 'ignore' }).status !== 0) {
    warn('docker CLI not found.');
    return false;
  }

  // Hung-but-running case (TCP accepts, HTTP timeouts) → restart clears it.
  // Down case → `up -d` starts it. `up -d` on a healthy container is a no-op,
  // so we branch to avoid an unnecessary recreate.
  if (containerRunning()) {
    log('container is up but not serving — restarting');
    docker(['compose', 'restart', 'cube_api']);
  } else {
    log('starting cube_api + cubestore');
    docker(['compose', 'up', '-d', 'cube_api', 'cubestore']);
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  if (await waitReady(deadline)) {
    log('cube_api is ready');
    return true;
  }
  warn(`cube_api still not ready after ${READY_TIMEOUT_MS / 1000}s — check 'docker compose -f ${CUBE_DEV_PATH}/docker-compose.yml logs cube_api'.`);
  return false;
}

async function bootGuard() {
  if (await probe()) return;
  log(`cube_api unreachable at ${CUBE_API_URL} — attempting recovery`);
  await recoverOnce();
}

async function watchLoop() {
  log(`watchdog started — probing every ${WATCH_INTERVAL_MS / 1000}s, restarting after ${WATCH_FAILURE_THRESHOLD} consecutive misses`);
  let consecutiveFailures = 0;
  let cooldownUntil = 0;

  // SIGINT/SIGTERM from concurrently land here so the loop exits cleanly.
  let stopped = false;
  const stop = () => { stopped = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopped) {
    await new Promise((r) => setTimeout(r, WATCH_INTERVAL_MS));
    if (stopped) break;

    if (await probe()) {
      consecutiveFailures = 0;
      continue;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures < WATCH_FAILURE_THRESHOLD) continue;
    if (Date.now() < cooldownUntil) {
      log(`cube_api still missing but in cooldown — skipping restart`);
      continue;
    }

    // Busy-but-alive guard: one generous final probe. A cube_api mid pre-agg
    // build answers /livez slowly, not never — don't interrupt it.
    if (await probe(GRACE_PROBE_TIMEOUT_MS)) {
      log(`cube_api answered the ${GRACE_PROBE_TIMEOUT_MS / 1000}s grace probe — busy, not down; skipping restart`);
      consecutiveFailures = 0;
      continue;
    }

    log(`cube_api unreachable for ${consecutiveFailures} consecutive probes + failed grace probe — triggering recovery`);
    cooldownUntil = Date.now() + WATCH_COOLDOWN_MS;
    await recoverOnce();
    consecutiveFailures = 0;
  }
  log('watchdog stopped');
}

const isWatch = process.argv.includes('--watch');
const entry = isWatch ? watchLoop : bootGuard;
entry().catch((err) => {
  warn(`unexpected error: ${err?.message ?? err}. Continuing.`);
});
