/**
 * schema-write-validator.ts
 * Input validation for the schema-write handler:
 * identifier regex, reserved-keyword guard, body-size reader.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { jsonError } from './schema-write-response.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const RESERVED_KEYWORDS = new Set([
  'joins', 'dimensions', 'segments', 'measures',
  'pre_aggregations', 'sql', 'extends', 'data_source',
]);

const BODY_LIMIT_BYTES = 16 * 1024; // 16 KB

// ---------------------------------------------------------------------------
// Body reader
// ---------------------------------------------------------------------------

/** Consumes up to `limitBytes` from the request stream; rejects if exceeded. */
export async function readBody(req: IncomingMessage, limitBytes = BODY_LIMIT_BYTES): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const readable = req as unknown as Readable;

    readable.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error(`Request body exceeds ${limitBytes} byte limit`));
        readable.destroy();
        return;
      }
      chunks.push(chunk);
    });
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export type EntryKind = 'measure' | 'dimension' | 'segment';

const VALID_KINDS: ReadonlySet<EntryKind> = new Set(['measure', 'dimension', 'segment']);

/**
 * HTTP request body. `entryName` is the canonical key; `measureName` is kept
 * as a legacy alias for clients that haven't migrated yet. Validator normalizes
 * to `entryName` so downstream code can ignore the alias.
 */
export interface WriteBody {
  cubeName: string;
  /** Canonical entry name (measure, dimension, or segment name). */
  entryName?: string;
  /** Legacy alias for `entryName` — kept for HTTP back-compat. */
  measureName?: string;
  kind?: EntryKind;
  yamlPatch: string;
}

/** Body shape after normalization — single source of truth used by handler. */
export interface NormalizedWriteBody {
  cubeName: string;
  entryName: string;
  kind: EntryKind;
  yamlPatch: string;
}

/**
 * Validates body fields. On success returns the normalized body. On failure
 * writes the appropriate 400 error response and returns `null`.
 *
 * Body accepts `entryName` (canonical) OR `measureName` (legacy alias).
 * `kind` defaults to `'measure'` so legacy callers without the field still
 * work.
 */
export function validateWriteBody(
  body: WriteBody,
  res: ServerResponse,
): NormalizedWriteBody | null {
  const { cubeName, yamlPatch } = body;
  const entryName = body.entryName ?? body.measureName;
  const kind: EntryKind = body.kind ?? 'measure';

  if (typeof cubeName !== 'string' || !IDENTIFIER_RE.test(cubeName)) {
    jsonError(res, 400, 'invalid-cubeName: must match /^[A-Za-z_][A-Za-z0-9_]*$/');
    return null;
  }
  if (typeof entryName !== 'string' || !IDENTIFIER_RE.test(entryName)) {
    jsonError(
      res,
      400,
      'invalid-entryName: must match /^[A-Za-z_][A-Za-z0-9_]*$/ (legacy field "measureName" also accepted)',
    );
    return null;
  }
  if (!VALID_KINDS.has(kind)) {
    jsonError(res, 400, `invalid-kind: "${kind}" — must be measure | dimension | segment`);
    return null;
  }
  if (RESERVED_KEYWORDS.has(cubeName)) {
    jsonError(res, 400, `cubeName "${cubeName}" is a reserved keyword`);
    return null;
  }
  if (RESERVED_KEYWORDS.has(entryName)) {
    jsonError(res, 400, `entryName "${entryName}" is a reserved keyword`);
    return null;
  }
  if (typeof yamlPatch !== 'string' || yamlPatch.trim() === '') {
    jsonError(res, 400, 'yamlPatch must be a non-empty string');
    return null;
  }
  return { cubeName, entryName, kind, yamlPatch };
}
