/**
 * App-settings routes.
 *   GET  /api/settings           → { [key]: jsonValue }
 *   PATCH /api/settings          → body { key, value }
 *
 * Validation lives in app-settings-store; routes are a thin wrapper.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listAllSettings, patchSetting } from '../services/app-settings-store.js';

const patchSchema = z.object({
  key: z.string().min(1).max(128),
  value: z.unknown(),
});

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    return listAllSettings();
  });

  app.patch('/api/settings', async (req, reply) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const result = patchSetting(parsed.data.key, parsed.data.value);
    if (!result.ok) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: result.message } });
    }
    return { key: parsed.data.key, value: result.value };
  });
}
