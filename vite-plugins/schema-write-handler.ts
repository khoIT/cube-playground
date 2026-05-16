/**
 * schema-write-handler.ts
 * Core HTTP handler for POST /api/playground/schema/write.
 *
 * Depends on:
 *   schema-write-response.ts  — jsonError / jsonOk
 *   schema-write-validator.ts — readBody / validateWriteBody / WriteBody
 *   schema-file-ops.ts        — resolveTargetPath, writeTmp, renameTmp, …
 *   yaml-splice.ts            — splice
 *   meta-poll.ts              — waitForMember
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import { jsonError, jsonOk } from './schema-write-response.js';
import { readBody, validateWriteBody, type WriteBody } from './schema-write-validator.js';
import {
  resolveTargetPath,
  atomicWrite,
  writeTmp,
  renameTmp,
  unlinkTmp,
  writeBak,
  restoreBak,
  hasExternalChange,
  appendAudit,
} from './schema-file-ops.js';
import { splice } from './yaml-splice.js';
import { waitForMember } from './meta-poll.js';

// Re-export so the middleware can use it without touching response helpers directly.
export { jsonError } from './schema-write-response.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandlerDeps {
  modelDir: string | null;
  cubeApiUrl: string;
  cubeToken: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleWriteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
): Promise<void> {
  // Belt-and-braces production guard (apply:'serve' is the primary gate).
  if (process.env.NODE_ENV !== 'development') {
    jsonError(res, 403, 'endpoint-disabled-in-production');
    return;
  }
  if (!deps.modelDir) {
    jsonError(res, 500, 'model-dir-not-configured');
    return;
  }
  if (req.method === 'DELETE') {
    await handleDeleteRequest(req, res, deps);
    return;
  }
  if (req.method !== 'POST') {
    jsonError(res, 405, 'method-not-allowed');
    return;
  }

  // Parse body.
  let body: WriteBody;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw.toString('utf8')) as WriteBody;
  } catch (err) {
    jsonError(res, 400, `body-parse-error: ${String(err)}`);
    return;
  }

  if (!validateWriteBody(body, res)) return;

  const { cubeName, measureName, yamlPatch } = body;
  const modelRoot = deps.modelDir;

  // Resolve target file path.
  let targetPath: string;
  try {
    targetPath = await resolveTargetPath(modelRoot, cubeName);
  } catch (err) {
    jsonError(res, 404, `cube-file-not-found: ${String(err)}`);
    return;
  }

  // Read current content + mtime snapshot.
  let priorContent: string;
  let mtimeBefore: number;
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(targetPath, 'utf8'),
      fs.stat(targetPath),
    ]);
    priorContent = content;
    mtimeBefore = stat.mtimeMs;
  } catch (err) {
    jsonError(res, 500, `file-read-error: ${String(err)}`);
    return;
  }

  // Splice the new measure into the YAML.
  let nextContent: string;
  try {
    nextContent = splice(priorContent, cubeName, measureName, yamlPatch).next;
  } catch (err) {
    jsonError(res, 400, `yaml-splice-error: ${String(err)}`);
    return;
  }

  // Write .tmp, check mtime guard, write .bak, atomic rename.
  try {
    await writeTmp(targetPath, nextContent);
  } catch (err) {
    jsonError(res, 500, `tmp-write-error: ${String(err)}`);
    return;
  }

  try {
    if (await hasExternalChange(targetPath, mtimeBefore)) {
      await unlinkTmp(targetPath);
      jsonError(res, 409, 'conflict: file modified externally between read and write');
      return;
    }
  } catch (err) {
    await unlinkTmp(targetPath);
    jsonError(res, 500, `mtime-check-error: ${String(err)}`);
    return;
  }

  try {
    await writeBak(targetPath, priorContent);
    await renameTmp(targetPath);
  } catch (err) {
    await unlinkTmp(targetPath);
    jsonError(res, 500, `write-error: ${String(err)}`);
    return;
  }

  // Audit the successful write.
  const ts = new Date().toISOString();
  const ua = req.headers['user-agent'] ?? '';
  await appendAudit(modelRoot, { ts, ua, cubeName, measureName, yamlPatch, event: 'write' })
    .catch((err) => console.warn('[schema-write] audit append failed:', err));

  // Poll Cube /meta to confirm hot-reload picked up the new measure.
  // POC policy: on poll timeout, KEEP the file (no rollback) and return 200 with
  // a warning. Windows Docker bind-mount filewatcher events can be delayed; the
  // change likely lands eventually. If the YAML is bad, recover via `git checkout`.
  try {
    const meta = await waitForMember(deps.cubeApiUrl, cubeName, measureName, {
      timeoutMs: 15000,
      intervalMs: 250,
      token: deps.cubeToken || undefined,
    });
    jsonOk(res, { meta });
  } catch {
    await appendAudit(modelRoot, {
      ts: new Date().toISOString(), ua, cubeName, measureName, yamlPatch,
      event: 'kept-after-timeout', reason: 'meta-poll-timeout',
    }).catch((err) => console.warn('[schema-write] timeout audit append failed:', err));

    jsonOk(res, { meta: null, warning: 'meta-not-acknowledged' });
  }
}

// ---------------------------------------------------------------------------
// DELETE handler — Discard flow
// ---------------------------------------------------------------------------

/**
 * Discard a wizard-written measure by restoring the `.bak` over the target.
 * Body shape: `{ cubeName, measureName }` — `measureName` audited but not used
 * for the rollback path.
 */
async function handleDeleteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
): Promise<void> {
  const modelRoot = deps.modelDir!;

  let body: WriteBody;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw.toString('utf8')) as WriteBody;
  } catch (err) {
    jsonError(res, 400, `body-parse-error: ${String(err)}`);
    return;
  }

  if (!body?.cubeName || typeof body.cubeName !== 'string') {
    jsonError(res, 400, 'invalid-body: cubeName required');
    return;
  }
  if (!body?.measureName || typeof body.measureName !== 'string') {
    jsonError(res, 400, 'invalid-body: measureName required');
    return;
  }

  let targetPath: string;
  try {
    targetPath = await resolveTargetPath(modelRoot, body.cubeName);
  } catch (err) {
    jsonError(res, 404, `cube-file-not-found: ${String(err)}`);
    return;
  }

  try {
    await restoreBak(targetPath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      jsonError(res, 404, 'no-backup-found');
      return;
    }
    jsonError(res, 500, `restore-error: ${String(err)}`);
    return;
  }

  const ts = new Date().toISOString();
  const ua = req.headers['user-agent'] ?? '';
  await appendAudit(modelRoot, {
    ts,
    ua,
    cubeName: body.cubeName,
    measureName: body.measureName,
    event: 'delete-after-preview',
  }).catch((err) => console.warn('[schema-write] delete audit append failed:', err));

  jsonOk(res, { restored: true });
}
