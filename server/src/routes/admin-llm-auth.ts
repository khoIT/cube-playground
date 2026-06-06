/**
 * Admin LLM auth-mode API — read/switch the chat agent's credential lane.
 *
 *   GET /api/admin/llm-auth          → { status } (null when chat-service down)
 *   PUT /api/admin/llm-auth { mode } → switch 'auto' | 'gateway' | 'subscription'
 *
 * 'auto' is the full failover ladder (gateway keys → subscription last
 * resort); 'gateway'/'subscription' pin the lane. chat-service validates that
 * the requested lane has a configured credential and persists the choice.
 *
 * Guards: admin role + admin feature at router scope, like admin-cost.ts.
 * Graceful degradation on GET (status: null, never 500); PUT surfaces a 502
 * when chat-service is unreachable — a toggle that silently no-ops is worse.
 */

import type { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import {
  fetchLlmAuthStatus,
  setLlmAuthMode,
  type LlmAuthMode,
} from '../services/chat-llm-auth-client.js';

const ALLOWED_MODES: readonly LlmAuthMode[] = ['auto', 'gateway', 'subscription'];

export default async function adminLlmAuthRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  app.get('/api/admin/llm-auth', async () => {
    const status = await fetchLlmAuthStatus();
    return { generatedAt: Date.now(), status };
  });

  app.put<{ Body: { mode?: unknown } }>('/api/admin/llm-auth', async (req, reply) => {
    const mode = req.body?.mode;
    if (typeof mode !== 'string' || !(ALLOWED_MODES as readonly string[]).includes(mode)) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: "mode must be 'auto', 'gateway', or 'subscription'" },
      });
    }
    const result = await setLlmAuthMode(mode as LlmAuthMode);
    if (!result.ok) {
      // chat-service rejection (lane not configured) → 400 with its reason;
      // transport failure → 502 so the admin knows the toggle did NOT apply.
      if (result.errorMessage) {
        return reply.status(400).send({ error: { code: 'MODE_REJECTED', message: result.errorMessage } });
      }
      return reply.status(502).send({
        error: { code: 'CHAT_SERVICE_UNAVAILABLE', message: 'chat-service unreachable — mode unchanged' },
      });
    }
    return { generatedAt: Date.now(), status: result.status };
  });
}
