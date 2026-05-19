/**
 * Returns the SHA-256 hash of the last-seen Cube /meta payload.
 * Used by drift detection and the FE to know when schema changed.
 * Supports ?force=1 to bypass the 60s in-memory cache.
 */

import type { FastifyInstance } from 'fastify';
import { getVersion } from '../services/meta-cache.js';

export default async function metaVersionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/meta/version
  app.get('/api/meta/version', async (req, reply) => {
    const force = (req.query as Record<string, string>).force === '1';

    try {
      const result = await getVersion(force);
      return result;
    } catch (err) {
      return reply.status(502).send({
        error: { code: 'CUBE_UNREACHABLE', message: (err as Error).message },
      });
    }
  });
}
