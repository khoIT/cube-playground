/**
 * Git status + refresh for the local cube-prod clone (the validated oracle,
 * a checkout of kraken/cube). Powers the Model Audit "Upstream" tab.
 *
 * Read-only by contract: the only mutating op is an explicit ff-only `git pull`
 * triggered by the user's "Refresh from kraken/cube" button. We NEVER push and
 * NEVER touch the dev working tree here. All git runs via execFileSync with a
 * fixed arg array (no shell, no interpolation of caller input).
 */

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

/** Default prod-clone path; overridable via CUBE_PARITY_PROD_ROOT. */
export const PROD_ROOT = process.env.CUBE_PARITY_PROD_ROOT ?? '/Users/lap16299/Documents/code/cube-prod';

export interface ProdCloneStatus {
  root: string;
  available: boolean;
  localSha: string | null;
  upstreamSha: string | null;
  behind: number | null;
  ahead: number | null;
  /** epoch-ms of the clone's last fetch (FETCH_HEAD mtime), or null. */
  lastFetchAt: number | null;
  branch: string | null;
  error: string | null;
}

export interface RefreshResult {
  ok: boolean;
  localSha: string | null;
  changedFiles: string[];
  message: string;
}

function git(root: string, args: string[]): string {
  const opts: ExecFileSyncOptions = { cwd: root, encoding: 'utf8', timeout: 30_000 };
  return (execFileSync('git', args, opts) as string).trim();
}

function tryGit(root: string, args: string[]): string | null {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

function fetchHeadMtime(root: string): number | null {
  try {
    return Math.round(statSync(join(root, '.git', 'FETCH_HEAD')).mtimeMs);
  } catch {
    return null;
  }
}

/**
 * Local vs upstream state of the clone. Reads the already-fetched remote-tracking
 * ref (`@{u}`) — it does NOT hit the network, so the numbers reflect the last
 * fetch/pull. The Refresh action is what actually contacts kraken/cube.
 */
export function prodCloneStatus(root: string = PROD_ROOT): ProdCloneStatus {
  const localSha = tryGit(root, ['rev-parse', 'HEAD']);
  if (localSha === null) {
    return {
      root,
      available: false,
      localSha: null,
      upstreamSha: null,
      behind: null,
      ahead: null,
      lastFetchAt: null,
      branch: null,
      error: 'not a git repository (or git unavailable)',
    };
  }
  const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstreamSha = tryGit(root, ['rev-parse', '@{u}']);
  let behind: number | null = null;
  let ahead: number | null = null;
  if (upstreamSha) {
    // counts = "<behind>\t<ahead>" for HEAD relative to its upstream.
    const counts = tryGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    if (counts) {
      const [a, b] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10));
      ahead = Number.isNaN(a) ? null : a;
      behind = Number.isNaN(b) ? null : b;
    }
  }
  return {
    root,
    available: true,
    localSha,
    upstreamSha,
    behind,
    ahead,
    lastFetchAt: fetchHeadMtime(root),
    branch,
    error: null,
  };
}

/**
 * Fetch + fast-forward the clone from kraken/cube and report what changed.
 * ff-only so a diverged local can never trigger a merge commit; failures
 * (auth/VPN/network/diverged) surface as `ok:false` with the git message and
 * leave the clone untouched.
 */
export function refreshProdClone(root: string = PROD_ROOT): RefreshResult {
  const before = tryGit(root, ['rev-parse', 'HEAD']);
  if (before === null) {
    return { ok: false, localSha: null, changedFiles: [], message: 'not a git repository' };
  }
  try {
    git(root, ['fetch', '--quiet']);
    git(root, ['merge', '--ff-only', '@{u}']);
  } catch (err) {
    return {
      ok: false,
      localSha: before,
      changedFiles: [],
      message: String((err as Error).message ?? err).slice(0, 500),
    };
  }
  const after = tryGit(root, ['rev-parse', 'HEAD']) ?? before;
  let changedFiles: string[] = [];
  if (after !== before) {
    const diff = tryGit(root, ['diff', '--name-only', `${before}..${after}`]);
    changedFiles = diff ? diff.split('\n').filter(Boolean) : [];
  }
  return {
    ok: true,
    localSha: after,
    changedFiles,
    message: after === before ? 'already up to date' : `updated ${before.slice(0, 8)} → ${after.slice(0, 8)}`,
  };
}
