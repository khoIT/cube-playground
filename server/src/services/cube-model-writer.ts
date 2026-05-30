/**
 * Atomic full-file writer for approved Cube models into the cube-dev model tree.
 *
 * Lifts the schema-write doctrine (`.tmp` → rename, `.bak` snapshot, `/meta`
 * poll, audit append) but writes a WHOLE cube file instead of splicing one
 * member. Unlike the POC schema-write handler (keep-on-timeout), onboarding
 * approval is atomic: a failed `/meta` poll ROLLS BACK (restore prior, or delete
 * a newly-created file).
 *
 * Target: `<VITE_CUBE_MODEL_DIR>/cubes/<game>/<cubeName>.yml`. Model dir is
 * required — refuse (no silent default) if `VITE_CUBE_MODEL_DIR` is unset.
 *
 * Write exposure is gated: refused unless `NODE_ENV !== 'production'` OR an
 * explicit `ONBOARDING_WRITE_ENABLED=true` opt-in. (Flagged for /ck:security.)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface WriteCubeModelInput {
  game: string;
  cubeName: string;
  yaml: string;
  /** Cube base URL (e.g. http://localhost:4000) from the resolved workspace ctx. */
  cubeApiUrl: string;
  /** Bearer token for the game-scoped /meta poll. */
  token: string | null;
  /** Actor for the audit row. */
  actor?: string | null;
  /** Override /meta poll timing (tests). */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface WriteCubeModelResult {
  path: string;
  metaAcknowledged: boolean;
}

export class CubeModelWriteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'CubeModelWriteError';
  }
}

function writeEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const raw = (process.env.ONBOARDING_WRITE_ENABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Resolve the cube-dev model root; throw if unconfigured. */
export function resolveModelDir(): string {
  const raw = process.env.VITE_CUBE_MODEL_DIR;
  if (!raw) throw new CubeModelWriteError('model-dir-not-configured', 'VITE_CUBE_MODEL_DIR is not set');
  return path.resolve(raw);
}

/** Slug shape for path segments — same as cube/member names elsewhere. */
const SEGMENT_RE = /^[a-z][a-z0-9_]*$/;

/**
 * `<root>/cubes/<game>/<cubeName>.yml`, with defense-in-depth path guards.
 * `game` and `cubeName` must be slugs — a value like `..` or `a/b` would
 * otherwise resolve a file outside the intended `cubes/<game>/` subtree even
 * though it stays under the model root.
 */
export function cubeFilePath(modelRoot: string, game: string, cubeName: string): string {
  if (!SEGMENT_RE.test(game)) throw new CubeModelWriteError('invalid-game', `game "${game}" is not a valid slug`);
  if (!SEGMENT_RE.test(cubeName)) throw new CubeModelWriteError('invalid-cube', `cube "${cubeName}" is not a valid slug`);
  const dir = path.resolve(modelRoot, 'cubes', game);
  const target = path.resolve(dir, `${cubeName}.yml`);
  // Resolved file must sit exactly in the intended cubes/<game>/ directory.
  if (path.dirname(target) !== dir || !target.startsWith(path.resolve(modelRoot) + path.sep)) {
    throw new CubeModelWriteError('path-traversal', 'resolved path escapes the cube model subtree');
  }
  return target;
}

/**
 * Poll Cube /meta until `<cubeName>.count` appears (every scaffolded cube has a
 * default count measure), or throw on timeout. Token scopes the tenant schema.
 */
async function pollMeta(
  cubeApiUrl: string,
  cubeName: string,
  token: string | null,
  timeoutMs = 15_000,
  intervalMs = 300,
): Promise<boolean> {
  const url = `${cubeApiUrl.replace(/\/$/, '')}/cubejs-api/v1/meta`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const deadline = Date.now() + timeoutMs;
  const qualified = `${cubeName}.count`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const meta = (await res.json()) as { cubes?: Array<{ name: string; measures?: Array<{ name: string }> }> };
        const cube = meta.cubes?.find((c) => c.name === cubeName);
        if (cube?.measures?.some((m) => m.name === qualified)) return true;
      }
    } catch {
      /* transient — retry until deadline */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// Best-effort file audit alongside the model tree. The DB audit in
// onboarding-draft-store is the AUTHORITATIVE record of write/approval intent;
// this JSONL is a convenience trail next to the YAML, so a failure here is
// logged-and-swallowed rather than failing the write.
async function appendAudit(modelRoot: string, row: Record<string, unknown>): Promise<void> {
  await fs
    .appendFile(path.join(modelRoot, '_audit.jsonl'), JSON.stringify(row) + '\n', 'utf8')
    .catch((err) => console.warn('[cube-model-writer] audit append failed:', err));
}

/**
 * Write the cube YAML atomically and confirm via /meta. Rolls back on poll
 * failure: restores the prior file if one existed, else removes the new file.
 */
export async function writeCubeModel(input: WriteCubeModelInput): Promise<WriteCubeModelResult> {
  if (!writeEnabled()) {
    throw new CubeModelWriteError('write-disabled-in-production', 'cube-model write is disabled in production');
  }
  const modelRoot = resolveModelDir();
  const target = cubeFilePath(modelRoot, input.game, input.cubeName);
  await fs.mkdir(path.dirname(target), { recursive: true });

  // Snapshot prior content (overwrite case) so we can roll back.
  let prior: string | null = null;
  try {
    prior = await fs.readFile(target, 'utf8');
  } catch {
    prior = null; // new file
  }

  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, input.yaml, 'utf8');
  await fs.rename(tmp, target);

  const ts = new Date().toISOString();
  await appendAudit(modelRoot, {
    ts,
    event: 'onboarding-write',
    game: input.game,
    cube: input.cubeName,
    actor: input.actor ?? null,
    overwrite: prior !== null,
  });

  const acknowledged = await pollMeta(
    input.cubeApiUrl,
    input.cubeName,
    input.token,
    input.pollTimeoutMs,
    input.pollIntervalMs,
  );
  if (!acknowledged) {
    // Atomic rollback — the model never went live. The forward write keeps
    // `prior` in memory, so the original content is never lost; but if the
    // rollback I/O itself fails we must surface that loudly (the live file may
    // now hold the bad model) rather than mask it behind the poll-timeout error.
    try {
      if (prior !== null) {
        await fs.writeFile(`${target}.rollback.tmp`, prior, 'utf8');
        await fs.rename(`${target}.rollback.tmp`, target);
      } else {
        await fs.unlink(target).catch(() => undefined);
      }
    } catch (rollbackErr) {
      await appendAudit(modelRoot, {
        ts: new Date().toISOString(),
        event: 'onboarding-rollback-failed',
        game: input.game,
        cube: input.cubeName,
        error: String(rollbackErr),
      });
      throw new CubeModelWriteError(
        'rollback-failed',
        `cube "${input.cubeName}" failed /meta poll AND rollback failed — ${target} may hold a bad model: ${String(rollbackErr)}`,
      );
    }
    await appendAudit(modelRoot, {
      ts: new Date().toISOString(),
      event: 'onboarding-rollback',
      game: input.game,
      cube: input.cubeName,
      reason: 'meta-poll-timeout',
    });
    throw new CubeModelWriteError('meta-poll-timeout', `cube "${input.cubeName}" did not appear in /meta — rolled back`);
  }

  return { path: target, metaAcknowledged: true };
}
