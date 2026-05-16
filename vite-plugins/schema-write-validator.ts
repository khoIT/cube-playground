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

export interface WriteBody {
  cubeName: string;
  measureName: string;
  yamlPatch: string;
}

/**
 * Validates `cubeName`, `measureName`, and `yamlPatch` fields.
 * Writes the appropriate 400 error response and returns `false` on failure.
 */
export function validateWriteBody(body: WriteBody, res: ServerResponse): boolean {
  const { cubeName, measureName, yamlPatch } = body;

  if (typeof cubeName !== 'string' || !IDENTIFIER_RE.test(cubeName)) {
    jsonError(res, 400, 'invalid-cubeName: must match /^[A-Za-z_][A-Za-z0-9_]*$/');
    return false;
  }
  if (typeof measureName !== 'string' || !IDENTIFIER_RE.test(measureName)) {
    jsonError(res, 400, 'invalid-measureName: must match /^[A-Za-z_][A-Za-z0-9_]*$/');
    return false;
  }
  if (RESERVED_KEYWORDS.has(cubeName)) {
    jsonError(res, 400, `cubeName "${cubeName}" is a reserved keyword`);
    return false;
  }
  if (RESERVED_KEYWORDS.has(measureName)) {
    jsonError(res, 400, `measureName "${measureName}" is a reserved keyword`);
    return false;
  }
  if (typeof yamlPatch !== 'string' || yamlPatch.trim() === '') {
    jsonError(res, 400, 'yamlPatch must be a non-empty string');
    return false;
  }
  return true;
}
