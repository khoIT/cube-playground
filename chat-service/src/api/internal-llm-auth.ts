/**
 * GET/PUT /internal/llm-auth-mode — admin bridge for the LLM auth-mode +
 * global-model toggle.
 *
 *   GET → { mode, keys, modelOverride, allowedModels, defaultModel }
 *         (keys = keyFailoverStatus(), labels only).
 *   PUT { mode } → switch which key/lane the failover ladder uses for all
 *         users: 'auto' | 'gateway' | a specific slot label
 *         ('subscription' | 'subscription-vy' | 'subscription-thi').
 *   PUT { model } → set/clear the global model override applied to every turn
 *         (null/'' clears; otherwise must be in config.allowedModels).
 * Both fields are independent; a PUT may carry either. Persisted in chat.db.
 *
 * Validation: a mode whose lane/slot has no configured credential is rejected
 * 400 (e.g. 'subscription-vy' without ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN_VY) —
 * the failover module's full-ladder fallback would silently ignore the toggle,
 * which is worse than telling the admin why it can't apply.
 *
 * Auth: same unconditional `x-internal-secret` gate as /internal/stats.
 */

import type { FastifyPluginAsync } from 'fastify';
import { buildInternalSecretGate, type InternalSecretGateOptions } from '../middleware/internal-secret.js';
import { keyFailoverStatus, configuredAuthKinds, configuredKeyLabels } from '../core/anthropic-key-failover.js';
import { getLlmAuthMode, setLlmAuthMode, isLlmAuthMode } from '../core/llm-auth-mode.js';
import { getLlmModelOverride, setLlmModelOverride } from '../core/llm-model-override.js';
import { config } from '../config.js';

interface InternalLlmAuthRouteOptions {
  /** Test-only override for the secret gate. */
  secretGate?: InternalSecretGateOptions;
}

function statusPayload() {
  return {
    mode: getLlmAuthMode(),
    keys: keyFailoverStatus(),
    modelOverride: getLlmModelOverride(),
    allowedModels: config.allowedModels,
    defaultModel: config.chatModel,
  };
}

const internalLlmAuthRoutes: FastifyPluginAsync<InternalLlmAuthRouteOptions> = async (
  fastify,
  opts,
) => {
  const gate = buildInternalSecretGate(opts.secretGate);

  fastify.get('/internal/llm-auth-mode', { preHandler: gate }, async (_req, reply) => {
    reply.send(statusPayload());
  });

  fastify.put<{ Body: { mode?: unknown; model?: unknown } }>(
    '/internal/llm-auth-mode',
    { preHandler: gate },
    async (req, reply) => {
      const body = req.body ?? {};
      const hasMode = 'mode' in body;
      const hasModel = 'model' in body;
      if (!hasMode && !hasModel) {
        reply.status(400).send({ error: 'no_change', message: 'Provide a "mode" or "model" to change' });
        return;
      }

      // --- Key/lane selection ---
      if (hasMode) {
        const requested = body.mode;
        if (!isLlmAuthMode(requested)) {
          reply.status(400).send({
            error: 'invalid_mode',
            allowed: ['auto', 'gateway', 'subscription', 'subscription-vy', 'subscription-thi'],
          });
          return;
        }
        const kinds = configuredAuthKinds();
        if (requested === 'gateway' && !kinds.includes('gateway-key')) {
          reply.status(400).send({
            error: 'gateway_not_configured',
            message: 'No gateway API key is configured on the chat-service',
          });
          return;
        }
        // A specific slot label must have a configured token.
        if (requested !== 'auto' && requested !== 'gateway' && !configuredKeyLabels().includes(requested)) {
          reply.status(400).send({
            error: 'key_not_configured',
            message: `No credential configured for '${requested}' on the chat-service`,
          });
          return;
        }
        setLlmAuthMode(requested);
      }

      // --- Global model override ---
      if (hasModel) {
        const model = body.model;
        const cleared = model === null || model === '';
        if (!cleared && (typeof model !== 'string' || !config.allowedModels.includes(model))) {
          reply.status(400).send({ error: 'invalid_model', allowed: config.allowedModels });
          return;
        }
        setLlmModelOverride(cleared ? null : (model as string));
      }

      reply.send(statusPayload());
    },
  );
};

export default internalLlmAuthRoutes;
