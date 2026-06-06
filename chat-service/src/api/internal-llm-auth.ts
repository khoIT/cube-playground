/**
 * GET/PUT /internal/llm-auth-mode — admin bridge for the LLM auth-mode toggle.
 *
 *   GET → { mode, keys } where keys = keyFailoverStatus() (labels only).
 *   PUT { mode: 'auto'|'gateway'|'subscription' } → switches the lane the
 *   failover ladder may use, persisted in chat.db (survives restart).
 *
 * Validation: a mode whose lane has no configured credential is rejected with
 * 400 (e.g. 'subscription' without ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN set) —
 * the failover module's full-ladder fallback would silently ignore the toggle,
 * which is worse than telling the admin why it can't apply.
 *
 * Auth: same unconditional `x-internal-secret` gate as /internal/stats.
 */

import type { FastifyPluginAsync } from 'fastify';
import { buildInternalSecretGate, type InternalSecretGateOptions } from '../middleware/internal-secret.js';
import { keyFailoverStatus, configuredAuthKinds } from '../core/anthropic-key-failover.js';
import { getLlmAuthMode, setLlmAuthMode, isLlmAuthMode } from '../core/llm-auth-mode.js';

interface InternalLlmAuthRouteOptions {
  /** Test-only override for the secret gate. */
  secretGate?: InternalSecretGateOptions;
}

function statusPayload() {
  return { mode: getLlmAuthMode(), keys: keyFailoverStatus() };
}

const internalLlmAuthRoutes: FastifyPluginAsync<InternalLlmAuthRouteOptions> = async (
  fastify,
  opts,
) => {
  const gate = buildInternalSecretGate(opts.secretGate);

  fastify.get('/internal/llm-auth-mode', { preHandler: gate }, async (_req, reply) => {
    reply.send(statusPayload());
  });

  fastify.put<{ Body: { mode?: unknown } }>(
    '/internal/llm-auth-mode',
    { preHandler: gate },
    async (req, reply) => {
      const requested = req.body?.mode;
      if (!isLlmAuthMode(requested)) {
        reply.status(400).send({ error: 'invalid_mode', allowed: ['auto', 'gateway', 'subscription'] });
        return;
      }
      const kinds = configuredAuthKinds();
      if (requested === 'subscription' && !kinds.includes('oauth-token')) {
        reply.status(400).send({
          error: 'subscription_not_configured',
          message: 'ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN is not set on the chat-service',
        });
        return;
      }
      if (requested === 'gateway' && !kinds.includes('gateway-key')) {
        reply.status(400).send({
          error: 'gateway_not_configured',
          message: 'No gateway API key is configured on the chat-service',
        });
        return;
      }
      setLlmAuthMode(requested);
      reply.send(statusPayload());
    },
  );
};

export default internalLlmAuthRoutes;
