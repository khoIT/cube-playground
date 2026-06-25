/**
 * Admin API-key management for the public export surface.
 *
 * Router-scope gated by `requireRole('admin')` + `requireFeature('admin')` —
 * the same guard the rest of the admin hub uses (NOT the public api-key auth;
 * this is the FE app-JWT admin path). Mints/lists/revokes keys and exposes the
 * read-only pull-audit log. The plaintext key is returned EXACTLY ONCE, on
 * create — never again, never logged.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { createKey, listKeys, revokeKey } from '../auth/api-key-store.js';
import { listPullAudit } from '../auth/public-pull-audit.js';

const createBody = z.object({
  label: z.string().min(1).max(120),
  workspace: z.string().min(1),
  segmentIds: z.array(z.string()).nonempty().nullable().optional(),
  gameIds: z.array(z.string()).nonempty().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export default async function apiKeyAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  app.get('/api/admin/api-keys', async () => ({ keys: listKeys() }));

  app.get('/api/admin/api-keys/audit', async (req) => {
    const { limit } = req.query as { limit?: string };
    const n = Math.min(Number(limit) || 200, 1000);
    return { audit: listPullAudit(n) };
  });

  app.post('/api/admin/api-keys', async (req, reply) => {
    const parse = createBody.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: parse.error.message } });
    }
    const { label, workspace, segmentIds, gameIds, expiresAt } = parse.data;
    const created = createKey({
      label,
      workspace,
      segmentIds: segmentIds ?? null,
      gameIds: gameIds ?? null,
      expiresAt: expiresAt ?? null,
      createdBy: req.user?.email ?? req.user?.id ?? 'unknown',
    });
    // Plaintext shown ONCE. The client must surface it now; it is never re-fetchable.
    return reply.status(201).send({ key: created.item, plaintext: created.plaintext });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/api-keys/:id', async (req, reply) => {
    const ok = revokeKey(req.params.id);
    if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Key not found' } });
    return { revoked: true };
  });
}
