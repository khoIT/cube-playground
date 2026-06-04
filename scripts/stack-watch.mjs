#!/usr/bin/env node
/**
 * Local prod-mirror watcher — commit-triggered.
 *
 * Watches the git `main` ref and rebuilds + restarts ONLY the `web` service of
 * the local prod-mirror stack (http://localhost:11000) each time a commit lands
 * on `main`, so the baked-bundle nginx image tracks merged work — not every
 * unsaved keystroke.
 *
 * This is NOT a fast dev loop — every trigger runs a full `vite build` inside
 * Docker (tens of seconds, memory-hungry). For iteration use `npm run dev`
 * (Vite HMR); reach for this only when you want :11000 to reflect what has
 * actually been committed to `main`.
 *
 * Trigger: the tip SHA of `main` changes (commit, amend, merge, reset, pull
 * fast-forward — anything that moves the ref). Saving/editing files does NOT
 * trigger a rebuild; only a committed ref move does.
 *
 * Delegates the rebuild to scripts/stack-local.mjs (`up -d --build web`) so the
 * Apple-Silicon CubeStore tag + env-file handling are reused verbatim — no
 * platform warning, no drift from `npm run stack`.
 *
 * Usage:
 *   npm run stack:watch                 # watch `main`
 *   STACK_WATCH_BRANCH=dev npm run stack:watch   # watch a different branch
 *
 * Zero extra deps — uses Node's built-in fs.watch on git's loose-ref directory.
 */

import { spawn, execSync } from 'node:child_process';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const STACK_RUNNER = resolve(here, 'stack-local.mjs');

// Which branch's tip drives the rebuild. Defaults to `main`.
const BRANCH = process.env.STACK_WATCH_BRANCH || 'main';
// Git updates a ref via a `.lock` file + rename; a short debounce lets that
// settle so we read the final SHA once instead of racing the rename.
const DEBOUNCE_MS = 500;

function log(msg) {
  process.stdout.write(`[stack:watch] ${msg}\n`);
}

function git(args) {
  return execSync(`git ${args}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

// Resolve git's common dir (handles worktrees) and the loose-ref directory we
// watch. `git rev-parse main` reads the SHA whether the ref is loose or packed.
const gitCommonDir = resolve(repoRoot, git('rev-parse --git-common-dir'));
const refsHeadsDir = join(gitCommonDir, 'refs', 'heads');

function currentSha() {
  try {
    return git(`rev-parse ${BRANCH}`);
  } catch {
    return null; // branch doesn't exist (yet)
  }
}

let lastSha = currentSha();
let debounceTimer = null;
let building = false;
let queued = false;

// Run `node stack-local.mjs up -d --build web`. Reuses the stack wrapper so the
// arch/env handling matches `npm run stack`. Output streams to the terminal.
function rebuildWeb(sha) {
  if (building) {
    // A newer commit landed mid-build — remember it and rebuild once this ends.
    queued = true;
    return;
  }
  building = true;
  log(`${BRANCH} → ${sha?.slice(0, 9)} — rebuilding web image…`);
  const child = spawn('node', [STACK_RUNNER, 'up', '-d', '--build', 'web'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    building = false;
    log(code === 0 ? 'web rebuilt — hard-refresh :11000 (Cmd+Shift+R)' : `rebuild exited ${code}`);
    if (queued) {
      queued = false;
      // Re-check in case the ref moved again while we were building.
      maybeRebuild();
    }
  });
}

// Read the ref's current SHA; rebuild only if it actually changed (dedupes the
// lock+rename double-event and ignores unrelated branch writes).
function maybeRebuild() {
  const sha = currentSha();
  if (!sha || sha === lastSha) return;
  lastSha = sha;
  rebuildWeb(sha);
}

function scheduleCheck() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(maybeRebuild, DEBOUNCE_MS);
}

log(`watching ${BRANCH} (${refsHeadsDir}) — rebuild on each new commit`);
log(`current ${BRANCH} tip: ${lastSha ? lastSha.slice(0, 9) : '(none)'}`);
log('Ctrl+C to stop. (Iterate with `npm run dev`; this rebuilds :11000 on commit.)');

// Watch the loose-ref directory (not the single file): git replaces the ref
// file via rename on each update, which would invalidate a file-level watch.
watch(refsHeadsDir, { recursive: true }, (_event, filename) => {
  // filename is the ref path relative to refs/heads, e.g. "main" or "feat/x".
  if (!filename) return;
  if (filename.split(/[\\/]/).join('/') !== BRANCH) return;
  scheduleCheck();
});
