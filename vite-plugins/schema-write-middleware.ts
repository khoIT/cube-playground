/**
 * schema-write-middleware.ts
 * Vite plugin factory: mounts POST /api/playground/schema/write in dev mode only.
 * Heavy handler logic lives in schema-write-handler.ts to stay under 200 lines.
 */

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handleWriteRequest, jsonError } from './schema-write-handler.js';

/**
 * Returns a Vite plugin that mounts the schema-write middleware.
 * Only active during `vite dev` (apply: 'serve').
 * Wire it conditionally: `...(mode === 'development' ? [schemaWriteMiddleware()] : [])`.
 */
export function schemaWriteMiddleware(): Plugin {
  let modelDir: string | null = null;

  return {
    name: 'schema-write',
    apply: 'serve',

    configureServer(server) {
      // Startup check: resolve and verify VITE_CUBE_MODEL_DIR exists + is writable.
      const rawModelDir = process.env.VITE_CUBE_MODEL_DIR;

      if (!rawModelDir) {
        console.warn(
          '[schema-write] WARNING: VITE_CUBE_MODEL_DIR is not set. ' +
            'POST /api/playground/schema/write will return 500 until configured.',
        );
      } else {
        const resolved = path.resolve(rawModelDir);
        // Non-blocking async check — do not stall the dev server startup.
        fs.access(resolved, fs.constants.R_OK | fs.constants.W_OK)
          .then(() => {
            modelDir = resolved;
            console.info(`[schema-write] model dir ready: ${resolved}`);
          })
          .catch((err: unknown) => {
            console.warn(
              `[schema-write] WARNING: VITE_CUBE_MODEL_DIR "${resolved}" ` +
                `is not accessible: ${String(err)}. Requests will return 500.`,
            );
          });
      }

      const cubeApiUrl =
        process.env.VITE_CUBE_API_URL ?? 'http://localhost:4000/cubejs-api/v1';
      const cubeToken = process.env.VITE_CUBE_TOKEN ?? '';

      server.middlewares.use(
        '/api/playground/schema/write',
        (req: IncomingMessage, res: ServerResponse) => {
          handleWriteRequest(req, res, { modelDir, cubeApiUrl, cubeToken }).catch(
            (err: unknown) => {
              console.error('[schema-write] unhandled error:', err);
              if (!res.headersSent) {
                jsonError(res, 500, `internal-error: ${String(err)}`);
              }
            },
          );
        },
      );
    },
  };
}
