/**
 * schema-file-ops.ts
 * File I/O primitives for the schema-write handler:
 * resolve target path, atomic write, backup, audit append.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolves `<modelRoot>/<cubeName>.yml` (or `.yaml`).
 * Throws on path traversal or if neither file exists.
 */
export async function resolveTargetPath(
  modelRoot: string,
  cubeName: string,
): Promise<string> {
  const normalRoot = path.resolve(modelRoot);

  for (const ext of ['.yml', '.yaml']) {
    const candidate = path.resolve(normalRoot, `${cubeName}${ext}`);
    // Traversal guard: resolved path must stay inside modelRoot.
    if (!candidate.startsWith(normalRoot + path.sep) && candidate !== normalRoot) {
      throw new Error('path traversal detected');
    }
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next extension.
    }
  }
  throw new Error(`${cubeName}.yml / .yaml not found under model dir`);
}

// ---------------------------------------------------------------------------
// Atomic write helpers
// ---------------------------------------------------------------------------

/** Writes content to `<targetPath>.tmp` then renames it over `targetPath`. */
export async function atomicWrite(
  targetPath: string,
  content: string,
): Promise<void> {
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, targetPath);
}

/** Writes content to `<targetPath>.tmp` without renaming (pre-rename step). */
export async function writeTmp(targetPath: string, content: string): Promise<void> {
  await fs.writeFile(`${targetPath}.tmp`, content, 'utf8');
}

/** Renames `<targetPath>.tmp` over `targetPath`. */
export async function renameTmp(targetPath: string): Promise<void> {
  await fs.rename(`${targetPath}.tmp`, targetPath);
}

/** Removes `<targetPath>.tmp` silently (cleanup on error paths). */
export async function unlinkTmp(targetPath: string): Promise<void> {
  await fs.unlink(`${targetPath}.tmp`).catch(() => undefined);
}

/**
 * Writes a `.bak` copy of prior content alongside the target file.
 *
 * First-write-wins semantics: if a `.bak` already exists, the existing copy is
 * preserved. This protects the true pre-wizard original across the debounced
 * live-preview re-writes (the Discard flow restores from `.bak`, so clobbering
 * it on every preview iteration would lose the genuine starting state).
 *
 * Callers that need to start a fresh tracking session (e.g. after a successful
 * Define keep) should delete `.bak` explicitly via `clearBak`.
 */
export async function writeBak(targetPath: string, priorContent: string): Promise<void> {
  const bakPath = `${targetPath}.bak`;
  try {
    await fs.access(bakPath);
    return; // .bak already exists — preserve the original
  } catch {
    /* .bak missing — safe to write */
  }
  await fs.writeFile(bakPath, priorContent, 'utf8');
}

/**
 * Restores `<targetPath>.bak` over `targetPath` atomically and removes the
 * backup. Throws if `.bak` is missing (caller maps that to HTTP 404).
 */
export async function restoreBak(targetPath: string): Promise<void> {
  const bakPath = `${targetPath}.bak`;
  await fs.access(bakPath); // throws ENOENT if missing — caller catches
  const bakContent = await fs.readFile(bakPath, 'utf8');
  await fs.writeFile(`${targetPath}.tmp`, bakContent, 'utf8');
  await fs.rename(`${targetPath}.tmp`, targetPath);
  await fs.unlink(bakPath).catch(() => undefined);
}

/** Removes the `.bak` file silently (used after a successful Define keep). */
export async function clearBak(targetPath: string): Promise<void> {
  await fs.unlink(`${targetPath}.bak`).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// mtime guard
// ---------------------------------------------------------------------------

/**
 * Stats `targetPath` and compares mtime against `mtimeBefore`.
 * Returns `true` if the file has been modified externally.
 */
export async function hasExternalChange(
  targetPath: string,
  mtimeBefore: number,
): Promise<boolean> {
  const stat = await fs.stat(targetPath);
  return stat.mtimeMs !== mtimeBefore;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Appends a JSONL row to `<rootDir>/_audit.jsonl`. */
export async function appendAudit(
  rootDir: string,
  row: Record<string, unknown>,
): Promise<void> {
  const auditPath = path.join(rootDir, '_audit.jsonl');
  await fs.appendFile(auditPath, JSON.stringify(row) + '\n', 'utf8');
}
