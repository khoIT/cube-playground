#!/usr/bin/env node
/**
 * Local prod-mirror stack runner.
 *
 * One command to build + run the WHOLE production composition on a laptop, so a
 * change verified here behaves identically once pushed to playground.gds.vng.vn.
 * It layers docker-compose.local.yml (host deltas only) on docker-compose.prod.yml
 * (the single source of prod topology) — the two never drift because local reuses
 * prod verbatim and only overrides env_file + image arch.
 *
 * Usage (via npm):
 *   npm run stack              → up -d --build, then prints the URL
 *   npm run stack -- down      → tear down (add -v to also drop the volumes)
 *   npm run stack -- logs -f   → follow combined logs
 *   npm run stack -- ps        → service status
 *   npm run stack -- <any compose subcommand/args>
 *
 * Host adaptations it handles automatically:
 *   - Apple Silicon: sets CUBESTORE_TAG to the arm64v8 build (cubejs/cubestore is
 *     not multi-arch; the amd64 :latest prod default won't run natively).
 *     Escape hatch: STACK_PLATFORM=linux/amd64 forces full amd64 emulation (the
 *     exact prod image bytes via Rosetta) instead.
 *   - Missing .env.docker.local: copies the .example and continues (the stack
 *     still boots in AUTH_DISABLED posture; chat-service is skipped until the
 *     ANTHROPIC_* keys are filled in).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { arch } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const PROD_COMPOSE = 'docker-compose.prod.yml';
const LOCAL_COMPOSE = 'docker-compose.local.yml';
// Dev-cube override — layered only when STACK_DEV_CUBE=1 (the dev:all watchdog
// sets it). Flips cube_api to standalone file-auth on :4000 for the `npm run dev`
// loop; the full `npm run stack` omits it and keeps the prod auth bridge.
const DEVCUBE_COMPOSE = 'docker-compose.devcube.yml';
const ENV_FILE = '.env.docker.local';
const ENV_EXAMPLE = '.env.docker.local.example';
// Native arm64 Cube Store tag — cubejs/cubestore publishes this separately from
// the amd64 :latest the prod runner uses; cubejs/cube itself is multi-arch.
const ARM64_CUBESTORE_TAG = 'v1.6.46-arm64v8';

function log(msg) {
  process.stdout.write(`[stack] ${msg}\n`);
}

// --- Ensure the env file exists ---------------------------------------------
const envPath = resolve(repoRoot, ENV_FILE);
if (!existsSync(envPath)) {
  const examplePath = resolve(repoRoot, ENV_EXAMPLE);
  if (!existsSync(examplePath)) {
    log(`ERROR: neither ${ENV_FILE} nor ${ENV_EXAMPLE} found in ${repoRoot}.`);
    process.exit(1);
  }
  copyFileSync(examplePath, envPath);
  log(`created ${ENV_FILE} from ${ENV_EXAMPLE} — review it (Trino + ANTHROPIC creds) before relying on data queries / chat.`);
}

// --- Select cubestore image arch for the host -------------------------------
const childEnv = { ...process.env };

// Force BuildKit. The Dockerfile opens with `# syntax=docker/dockerfile:1.7` and
// the prod CI builds with BuildKit (it relies on the predefined *_PROXY arg
// stripping); the legacy builder ignores the syntax directive, is less
// memory-efficient (more prone to OOM-killing the vite build), and diverges from
// the prod build path. Setting these env vars enables the daemon's built-in
// BuildKit even when the buildx CLI plugin isn't installed.
childEnv.DOCKER_BUILDKIT ??= '1';
childEnv.COMPOSE_DOCKER_CLI_BUILD ??= '1';
const forcedPlatform = process.env.STACK_PLATFORM;
if (forcedPlatform) {
  // Run every image under the forced platform (e.g. linux/amd64 via Rosetta) —
  // the closest possible byte-for-byte parity with the prod runner.
  childEnv.DOCKER_DEFAULT_PLATFORM = forcedPlatform;
  log(`STACK_PLATFORM set → DOCKER_DEFAULT_PLATFORM=${forcedPlatform} (emulating; ignoring CUBESTORE_TAG arch pick).`);
} else if (arch() === 'arm64' && !process.env.CUBESTORE_TAG) {
  childEnv.CUBESTORE_TAG = ARM64_CUBESTORE_TAG;
  log(`arm64 host → CUBESTORE_TAG=${ARM64_CUBESTORE_TAG} (native cubestore).`);
}

// --- Assemble the compose invocation ----------------------------------------
// No extra args → sensible default: build fresh + start detached.
const passthrough = process.argv.slice(2);
const composeArgs = passthrough.length > 0 ? passthrough : ['up', '-d', '--build'];

// Preflight: the vite build is memory-hungry and the kernel OOM-killer silently
// SIGKILLs it (exit 137, "Killed") on an under-provisioned Docker VM — the most
// likely first-run failure. Warn early with the colima fix instead of a cryptic
// 137. Only for commands that build; `down`/`logs`/`ps` don't need the RAM.
const willBuild = composeArgs.some((a) => a === 'build' || a === 'up' || a === '--build');
if (willBuild) {
  const info = spawnSync('docker', ['info', '--format', '{{.MemTotal}}'], { encoding: 'utf8' });
  const memBytes = Number((info.stdout || '').trim());
  const MIN_GIB = 6;
  if (Number.isFinite(memBytes) && memBytes > 0 && memBytes < MIN_GIB * 1024 ** 3) {
    const gib = (memBytes / 1024 ** 3).toFixed(1);
    log(`WARNING: Docker has only ${gib} GiB — the SPA build may be OOM-killed (exit 137).`);
    log(`         Recommend ≥${MIN_GIB} GiB. colima: 'colima stop && colima start --cpu 4 --memory 8'.`);
  }
}

const args = [
  'compose',
  '-f', PROD_COMPOSE,
  '-f', LOCAL_COMPOSE,
  ...(process.env.STACK_DEV_CUBE === '1' ? ['-f', DEVCUBE_COMPOSE] : []),
  '--env-file', ENV_FILE,
  ...composeArgs,
];

log(`docker ${args.join(' ')}`);
const res = spawnSync('docker', args, { cwd: repoRoot, stdio: 'inherit', env: childEnv });

if (res.error) {
  log(`failed to launch docker: ${res.error.message}`);
  process.exit(1);
}

// On a successful default `up`, point the user at the mirrored SPA.
if (passthrough.length === 0 && res.status === 0) {
  const port = childEnv.PUBLIC_PORT || '11000';
  log(`stack up → SPA http://localhost:${port}  |  Cube Playground http://localhost:${childEnv.CUBE_PUBLIC_PORT || '17001'}`);
  log(`logs: npm run stack -- logs -f   stop: npm run stack -- down`);
}

process.exit(res.status ?? 0);
