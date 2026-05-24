#!/usr/bin/env node
/**
 * Boot guard for the external Cube backend.
 *
 * Probes http://localhost:4000/livez. If the API responds, exits silently.
 * If TCP accepts but HTTP hangs (observed mode: container "Up" but stuck),
 * `docker compose restart cube_api` clears it. If the container is down,
 * `docker compose up -d` starts it. Never blocks `npm run dev:all` — on any
 * unrecoverable failure (missing docker, missing repo, still-not-ready after
 * timeout) it prints a banner and exits 0 so vite/server/chat keep booting.
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
const PROBE_TIMEOUT_MS = 4000;
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2000;

const log = (msg) => process.stdout.write(`[cube-guard] ${msg}\n`);
const warn = (msg) => process.stderr.write(`[cube-guard] ${msg}\n`);

async function probe() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
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

async function main() {
  if (await probe()) return;

  log(`cube_api unreachable at ${CUBE_API_URL} — attempting recovery`);

  if (!existsSync(CUBE_DEV_PATH)) {
    warn(`cube-dev repo not found at ${CUBE_DEV_PATH}. Set CUBE_DEV_PATH or start cube manually. Continuing without it.`);
    return;
  }
  if (spawnSync('docker', ['--version'], { stdio: 'ignore' }).status !== 0) {
    warn('docker CLI not found. Continuing without cube_api.');
    return;
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
    return;
  }

  warn(`cube_api still not ready after ${READY_TIMEOUT_MS / 1000}s — check 'docker compose -f ${CUBE_DEV_PATH}/docker-compose.yml logs cube_api'. Continuing.`);
}

main().catch((err) => {
  warn(`unexpected error: ${err?.message ?? err}. Continuing.`);
});
