/**
 * POST /internal/segment-brief — one-shot LLM generation of the AI segment
 * brief for the main server. Body: { context, lang }. Gated by the same
 * unconditional `x-internal-secret` header as `/internal/stats` (first POST
 * internal route; the gate is method-agnostic).
 *
 * LLM call uses the gateway-keyed one-shot SDK pattern from the title
 * summariser (failover-aware active key, no tools) — NOT the dev-only
 * subscription-auth path used by seed pregeneration. Model comes from
 * CHAT_BRIEF_MODEL (default sonnet — the gateway key 403s non-sonnet models).
 *
 * Schema enforcement: parse + validate against the hardcoded brief schema,
 * ONE retry with a corrective suffix on mismatch, then 502.
 */

import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { buildInternalSecretGate, type InternalSecretGateOptions } from '../middleware/internal-secret.js';
import {
  getActiveAnthropicKey,
  reportKeyBalanceExhausted,
  isBalanceExhaustedError,
  anthropicAuthEnvFor,
} from '../core/anthropic-key-failover.js';
import { proxyEnvForChild } from '../core/claude-runner.js';
import { buildBriefPrompt, parseBriefResponse, type SegmentBrief } from '../core/segment-brief-prompt.js';

export interface SegmentBriefRouteOptions {
  /** Test seam — replaces the SDK one-shot call. */
  callLlm?: (prompt: string) => Promise<string>;
  /** Test-only override for the secret gate. */
  secretGate?: InternalSecretGateOptions;
}

interface BriefBody {
  context?: unknown;
  lang?: string;
}

/** One-shot, tool-less SDK completion on the failover-aware active key. */
async function defaultCallLlm(prompt: string): Promise<string> {
  const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
  const activeKey = getActiveAnthropicKey(config.briefModel);
  let result = '';
  for await (const msg of sdkQuery({
    prompt,
    options: {
      model: config.briefModel,
      env: {
        // Org egress proxy for the network-isolated prod runner — without it the
        // child's HTTPS call to the gateway hangs and the caller's timeout fires.
        ...proxyEnvForChild(),
        HOME: process.env['HOME'] ?? '/tmp',
        ...anthropicAuthEnvFor(activeKey),
      },
      permissionMode: 'dontAsk',
      disallowedTools: ['Read', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Edit', 'MultiEdit'],
    },
  })) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any;
    if (m.type === 'result') {
      if (m.subtype && m.subtype !== 'success' && isBalanceExhaustedError(m.result ?? '')) {
        reportKeyBalanceExhausted(activeKey.key, config.briefModel);
        throw new Error('llm_balance_exhausted');
      }
      result = m.result ?? '';
    }
  }
  return result;
}

const segmentBriefRoutes: FastifyPluginAsync<SegmentBriefRouteOptions> = async (fastify, opts) => {
  const gate = buildInternalSecretGate(opts.secretGate);
  const callLlm = opts.callLlm ?? defaultCallLlm;

  fastify.post<{ Body: BriefBody }>(
    '/internal/segment-brief',
    { preHandler: gate },
    async (req, reply) => {
      const { context, lang } = req.body ?? {};
      if (context == null || typeof context !== 'object') {
        return reply.status(400).send({ error: 'missing_context' });
      }
      const safeLang = lang === 'vi' ? 'vi' : 'en';
      const prompt = buildBriefPrompt(context, safeLang);

      let brief: SegmentBrief | null = null;
      let lastError = 'invalid_llm_response';
      // First attempt + one schema-corrective retry — beyond that the cohort
      // context itself is probably degenerate, so fail to the caller's
      // error-cache path instead of burning more gateway budget.
      for (let attempt = 0; attempt < 2 && !brief; attempt++) {
        const suffix =
          attempt === 0
            ? ''
            : '\n\nYour previous reply did not match the schema. Reply with ONLY the JSON object — no prose, no fences.';
        try {
          const raw = await callLlm(prompt + suffix);
          brief = parseBriefResponse(raw);
        } catch (err) {
          lastError = (err as Error).message || 'llm_call_failed';
          break; // transport/balance failure — retrying the same call won't help
        }
      }

      if (!brief) {
        req.log.warn({ lastError }, 'segment-brief generation failed');
        return reply.status(502).send({ error: lastError });
      }
      return reply.send(brief);
    },
  );
};

export default segmentBriefRoutes;
