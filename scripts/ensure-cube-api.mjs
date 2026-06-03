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
 * Recovery brings up the cube-playground stack's DEDICATED dev cube
 * (cube_api_dev + cubestore_dev, see docker-compose.devcube.yml) via the stack
 * wrapper — NOT the sibling cube-dev repo, and NOT the stack's own cube_api.
 * Keeping the dev cube a separate container lets `npm run dev:all` (:4000,
 * file auth) and `npm run stack` (:17001, server-bridge auth) run at the same
 * time without recreating each other's container.
 *
 * Env overrides:
 *   CUBE_API_URL   default http://localhost:4000  (the dev-cube published port)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const STACK_SCRIPT = resolve(here, 'stack-local.mjs');
const ENV_FILE = '.env.docker.local';
const ENV_EXAMPLE = '.env.docker.local.example';
// The 3-file overlay the dev cube runs under (prod topology + local deltas +
// dev-cube standalone services). Used for the read-only `ps` running-check;
// up/restart go through the wrapper so the cubestore arch tag + env-file apply.
const COMPOSE_FILES = [
  '-f', 'docker-compose.prod.yml',
  '-f', 'docker-compose.local.yml',
  '-f', 'docker-compose.devcube.yml',
];
// The dedicated dev cube services (docker-compose.devcube.yml) — distinct from
// the stack's cube_api/cubestore so the dev loop and `npm run stack` don't
// recreate each other's container.
const DEV_CUBE_SERVICE = 'cube_api_dev';
const DEV_CUBESTORE_SERVICE = 'cubestore_dev';

const CUBE_API_URL = process.env.CUBE_API_URL ?? 'http://localhost:4000';
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

// Bring the dev cube up/down via the stack wrapper, which applies the cubestore
// arch tag, BuildKit, and --env-file. STACK_DEV_CUBE=1 makes the wrapper add the
// dev-cube override (standalone file-auth on :4000).
function stack(composeArgs) {
  return spawnSync(process.execPath, [STACK_SCRIPT, ...composeArgs], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, STACK_DEV_CUBE: '1' },
  });
}

// Read-only running check — docker compose ps over the same overlay.
function containerRunning() {
  const r = spawnSync('docker', ['compose', ...COMPOSE_FILES, '--env-file', ENV_FILE, 'ps', '--status', 'running', '--services'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (r.status !== 0) return false;
  return r.stdout.split('\n').some((s) => s.trim() === DEV_CUBE_SERVICE);
}

// The wrapper feeds --env-file .env.docker.local; ensure it exists (the wrapper
// would create it on an up/restart, but the ps check above runs first).
function ensureEnvFile() {
  const envPath = resolve(REPO_ROOT, ENV_FILE);
  if (existsSync(envPath)) return true;
  const examplePath = resolve(REPO_ROOT, ENV_EXAMPLE);
  if (!existsSync(examplePath)) {
    warn(`${ENV_FILE} and ${ENV_EXAMPLE} both missing — cannot start the dev cube.`);
    return false;
  }
  copyFileSync(examplePath, envPath);
  log(`created ${ENV_FILE} from ${ENV_EXAMPLE} — fill in CUBEJS_API_SECRET to match your dev .env.`);
  return true;
}

async function recoverOnce() {
  if (spawnSync('docker', ['--version'], { stdio: 'ignore' }).status !== 0) {
    warn('docker CLI not found.');
    return false;
  }
  if (!ensureEnvFile()) return false;

  // The dev cube is its own dedicated container, so there's no posture to
  // reconcile (unlike when it shared the stack's cube_api). Two cases:
  //   down               → `up -d` starts it (+ its cubestore).
  //   up but not serving → hung (TCP accepts, HTTP hangs); `restart` clears it.
  if (!containerRunning()) {
    log(`starting ${DEV_CUBE_SERVICE} + ${DEV_CUBESTORE_SERVICE} (dedicated dev cube)`);
    stack(['up', '-d', DEV_CUBE_SERVICE, DEV_CUBESTORE_SERVICE]);
  } else {
    log(`${DEV_CUBE_SERVICE} is up but not serving — restarting`);
    stack(['restart', DEV_CUBE_SERVICE]);
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  if (await waitReady(deadline)) {
    log(`${DEV_CUBE_SERVICE} is ready`);
    return true;
  }
  warn(`${DEV_CUBE_SERVICE} still not ready after ${READY_TIMEOUT_MS / 1000}s — check 'docker logs cube-playground-cube-api-dev'.`);
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
