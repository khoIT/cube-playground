#!/usr/bin/env node
/**
 * Dev-log capture — tees a child process's stdout/stderr to a rolling log
 * file under `logs/` while still forwarding output to this terminal.
 *
 * Policy (see logs/README.md):
 *   - File: logs/dev-all.log
 *   - Retention: last RETENTION_HOURS hours only. Older lines are pruned on
 *     startup and on a periodic timer, so the file stays small and an agent
 *     can read the whole thing for "what broke today" triage.
 *   - Each line is prefixed with an ISO-8601 timestamp; ANSI colour codes are
 *     stripped from the file copy (terminal copy keeps colour).
 *
 * KISS: time-based pruning rewrites the file in place. At dev-log volumes
 * (kilobytes/minute) this is cheap; no external rotation dep needed.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = resolve(here, '..', 'logs');
const LOG_FILE = resolve(LOG_DIR, 'dev-all.log');
const RETENTION_HOURS = 3;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // prune every 5 min

// Matches the ISO timestamp prefix we write, e.g. "[2026-05-27T01:12:30.123Z] "
const TS_PREFIX = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] /;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Drop lines whose timestamp is older than the retention window. */
function pruneOldLines() {
  if (!existsSync(LOG_FILE)) return;
  const cutoff = Date.now() - RETENTION_HOURS * 60 * 60 * 1000;
  let kept;
  try {
    const lines = readFileSync(LOG_FILE, 'utf8').split('\n');
    kept = lines.filter((line) => {
      const m = line.match(TS_PREFIX);
      if (!m) return true; // keep untimestamped continuation lines
      return new Date(m[1]).getTime() >= cutoff;
    });
  } catch {
    return; // never let log maintenance crash dev
  }
  writeFileSync(LOG_FILE, kept.join('\n'));
}

/**
 * Create a tee. Returns { onStdout, onStderr } chunk handlers to attach to a
 * piped child process. Forwards raw chunks to this process's tty (preserving
 * colour) and appends timestamped, ANSI-stripped lines to the log file.
 */
export function createDevLogCapture() {
  mkdirSync(LOG_DIR, { recursive: true });
  pruneOldLines();

  const sink = createWriteStream(LOG_FILE, { flags: 'a' });
  sink.write(`\n[${new Date().toISOString()}] ===== dev:all session started =====\n`);

  const timer = setInterval(pruneOldLines, PRUNE_INTERVAL_MS);
  timer.unref?.();

  // Per-stream line buffers so a chunk split mid-line still gets one prefix.
  const buffers = { out: '', err: '' };

  const makeHandler = (key, ttyStream) => (chunk) => {
    ttyStream.write(chunk); // keep terminal output intact (colour included)
    buffers[key] += chunk.toString();
    const parts = buffers[key].split('\n');
    buffers[key] = parts.pop() ?? ''; // trailing partial line stays buffered
    for (const line of parts) {
      const clean = line.replace(ANSI, '');
      sink.write(`[${new Date().toISOString()}] ${clean}\n`);
    }
  };

  const close = () => {
    for (const key of ['out', 'err']) {
      if (buffers[key]) {
        sink.write(`[${new Date().toISOString()}] ${buffers[key].replace(ANSI, '')}\n`);
        buffers[key] = '';
      }
    }
    sink.end();
  };

  return {
    logFile: LOG_FILE,
    onStdout: makeHandler('out', process.stdout),
    onStderr: makeHandler('err', process.stderr),
    close,
  };
}
