/**
 * Admin LLM auth-mode + model API — read/switch the chat agent's credential
 * key and the global model used for all users.
 *
 *   GET /api/admin/llm-auth           → { status } (null when chat-service down)
 *   PUT /api/admin/llm-auth { mode }  → switch the key/lane: 'auto' | 'gateway'
 *        | 'subscription' | 'subscription-vy' | 'subscription-thi'
 *   PUT /api/admin/llm-auth { model } → set/clear the global model override
 *        (null/'' clears; otherwise must be an allowed model id)
 *
 * 'auto' is the full failover ladder (gateway keys → subscription last
 * resort); 'gateway' pins the gateway lane; a specific slot label pins one key.
 * chat-service validates that the requested key/model exists and persists it.
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
  setLlmModelOverride,
  type LlmAuthMode,
  type SetLlmAuthModeResult,
} from '../services/chat-llm-auth-client.js';

const ALLOWED_MODES: readonly LlmAuthMode[] = [
  'auto',
  'gateway',
  'subscription',
  'subscription-vy',
  'subscription-thi',
];

export default async function adminLlmAuthRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  app.get('/api/admin/llm-auth', async () => {
    const status = await fetchLlmAuthStatus();
    return { generatedAt: Date.now(), status };
  });

  app.put<{ Body: { mode?: unknown; model?: unknown } }>('/api/admin/llm-auth', async (req, reply) => {
    const body = req.body ?? {};
    const hasMode = 'mode' in body;
    const hasModel = 'model' in body;
    if (!hasMode && !hasModel) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Provide a "mode" or "model" to change' },
      });
    }

    let result: SetLlmAuthModeResult;
    if (hasMode) {
      const mode = body.mode;
      if (typeof mode !== 'string' || !(ALLOWED_MODES as readonly string[]).includes(mode)) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: `mode must be one of: ${ALLOWED_MODES.join(', ')}` },
        });
      }
      result = await setLlmAuthMode(mode as LlmAuthMode);
    } else {
      const model = body.model;
      // null or '' clears the override; otherwise must be a string (chat-service
      // validates it against its allowed-model list and 400s with the reason).
      if (model !== null && model !== '' && typeof model !== 'string') {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'model must be a model id string, or null to clear' },
        });
      }
      result = await setLlmModelOverride((model as string | null) || null);
    }

    if (!result.ok) {
      // chat-service rejection (key/model not configured) → 400 with its reason;
      // transport failure → 502 so the admin knows the change did NOT apply.
      if (result.errorMessage) {
        return reply.status(400).send({ error: { code: 'CHANGE_REJECTED', message: result.errorMessage } });
      }
      return reply.status(502).send({
        error: { code: 'CHAT_SERVICE_UNAVAILABLE', message: 'chat-service unreachable — setting unchanged' },
      });
    }
    return { generatedAt: Date.now(), status: result.status };
  });
}
