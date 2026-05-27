#!/usr/bin/env node
/**
 * Cross-platform dev orchestrator.
 *
 * Runs vite + segments-server under `concurrently` as before. Launches
 * chat-service in its OWN console window on Windows because chat-service's
 * `tsx watch` hangs before any user code executes when its stdio is piped
 * through concurrently on Windows (reproducible May 2026 — boot-guard's
 * synchronous fs.writeSync never fires, indicating the hang is upstream
 * of user code, in tsx preflight + piped stdio).
 *
 * On macOS/Linux concurrently is fine for all three, so we delegate.
 *
 * Trade-off: on Windows Ctrl-C in THIS terminal kills vite + segments
 * (concurrently handles) but does NOT kill the detached chat-service
 * window — close it manually if you want a fully clean stop.
 */

import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDevLogCapture } from './dev-log-capture.mjs';

const isWindows = platform() === 'win32';
const here = dirname(fileURLToPath(import.meta.url));

// Boot guard for the external Cube backend. Synchronous so vite/server/chat
// don't race a not-yet-ready cube_api. The guard self-times-out and exits 0
// on any unrecoverable failure, so we never block dev startup.
spawnSync(process.execPath, [resolve(here, 'ensure-cube-api.mjs')], { stdio: 'inherit' });

function runConcurrently(args) {
  // shell:true is required on Windows so child_process can resolve the
  // npx.cmd shim — Node 18.20+/20.12+/22 (CVE-2024-27980 hardening) refuses
  // to spawn .cmd/.bat files without it. With shell:true the shell joins
  // args with spaces and re-tokenizes, so multi-word commands like
  // "npm run dev" must be quoted to survive as a single concurrently arg.
  const quoted = args.map((a) => (a.includes(' ') ? `"${a}"` : a));
  // Pipe (not inherit) so we can tee combined output to logs/dev-all.log while
  // still forwarding to this terminal. The capture rolls the file to the last
  // few hours so an agent can read it whole for daily triage.
  const log = createDevLogCapture();
  process.stdout.write(`[dev-all] capturing logs → ${log.logFile}\n`);
  const cc = spawn('npx', ['concurrently', ...quoted], { stdio: ['inherit', 'pipe', 'pipe'], shell: true });
  cc.stdout.on('data', log.onStdout);
  cc.stderr.on('data', log.onStderr);
  cc.on('exit', (code) => {
    log.close();
    process.exit(code ?? 0);
  });
}

// Long-running cube watchdog — keeps probing cube_api and restarts it on
// repeated failures so the hung-but-up mode auto-recovers mid-session.
const cubeWatch = `node ${JSON.stringify(resolve(here, 'ensure-cube-api.mjs'))} --watch`;

if (isWindows) {
  // `start "title" cmd /k <command>` opens a new console window and keeps
  // it open after the command exits (so boot-guard's error output stays
  // visible). The double-quoted title argument is required by `start`.
  spawn('cmd', ['/c', 'start', '"chat-service"', 'cmd', '/k', 'npm run chat:dev'], {
    stdio: 'ignore',
    detached: true,
  }).unref();

  process.stdout.write(
    '[dev-all] chat-service launched in a separate window — close it manually to stop\n',
  );

  runConcurrently([
    '-n', 'vite,server,cube',
    '-c', 'blue,green,yellow',
    'npm run dev',
    'npm run server:dev',
    cubeWatch,
  ]);
} else {
  runConcurrently([
    '-n', 'vite,server,chat,cube',
    '-c', 'blue,green,magenta,yellow',
    'npm run dev',
    'npm run server:dev',
    'npm run chat:dev',
    cubeWatch,
  ]);
}
