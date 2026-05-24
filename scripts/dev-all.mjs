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

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const isWindows = platform() === 'win32';

function runConcurrently(args) {
  // No shell: true — the shell would join args with spaces and re-tokenize,
  // splitting each "npm run dev" command into three separate words.
  // On Windows, npx is a .cmd file so we point at it directly.
  const npxCmd = isWindows ? 'npx.cmd' : 'npx';
  const cc = spawn(npxCmd, ['concurrently', ...args], { stdio: 'inherit' });
  cc.on('exit', (code) => process.exit(code ?? 0));
}

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
    '-n', 'vite,server',
    '-c', 'blue,green',
    'npm run dev',
    'npm run server:dev',
  ]);
} else {
  runConcurrently([
    '-n', 'vite,server,chat',
    '-c', 'blue,green,magenta',
    'npm run dev',
    'npm run server:dev',
    'npm run chat:dev',
  ]);
}
