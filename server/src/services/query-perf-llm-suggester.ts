/**
 * On-demand LLM fallback for slow queries that NO playbook covers.
 *
 * Fires ONLY when the matcher returns `needsLlm` AND an admin clicks
 * "Generate suggestion" — NEVER auto-run per captured query (the gateway key is
 * a shared, drainable resource; auto-running on capture is the documented
 * failure mode). Three cost guards: a hard timeout, a per-id in-memory cache
 * (re-opening the panel never re-calls), and a per-admin token-bucket rate limit.
 *
 * One short prompt → one suggestion. No agent loop, no tools, no streaming
 * (KISS/YAGNI). Talks to the LiteLLM gateway over fetch, mirroring
 * cube-model-enrichment — the gateway key is sonnet-only, so the model is pinned
 * to sonnet. The prompt carries the NAMES-only shape + verdict; no filter
 * values / UIDs are ever included (none are stored to begin with).
 */

import type { Verdict } from './query-perf-classifier.js';
import type { QueryShape } from './query-perf-store.js';

const TIMEOUT_MS = Number(process.env.LLM_SUGGEST_TIMEOUT_MS) || 60_000;
const RATE_LIMIT_PER_MIN = Number(process.env.LLM_SUGGEST_RATE_PER_MIN) || 5;
const MODEL = process.env.LITELLM_MODEL ?? 'claude-sonnet-4-6';

export type SuggestOk = { suggestion: string; lane: string };
export type SuggestErr = { error: string };
export type SuggestResult = SuggestOk | SuggestErr;

/** The gateway call, injectable so tests never hit the network. */
export type GatewayCall = (prompt: string, signal: AbortSignal) => Promise<string>;

/** NAMES-only prompt. Provably free of filter values / UIDs (none are passed in). */
export function buildLlmPrompt(verdict: Verdict, shape: QueryShape): string {
  return [
    'A Cube.js query is slow or failing and no standard optimization playbook matched it.',
    'Suggest a concise, concrete remedy. If structurally possible, sketch a rollup; otherwise explain why none fits.',
    '',
    `Cubes: ${shape.cubes.join(', ') || '(none)'}`,
    `Measures: ${shape.measures.join(', ') || '(none)'}`,
    `Dimensions: ${shape.dimensions.join(', ') || '(none)'}`,
    `Classifier verdict: matchability=${verdict.matchability}, preaggHit=${verdict.preaggHit}`,
    `Reason: ${verdict.reason}`,
    '',
    'Answer in under 150 words. Do not ask for more data.',
  ].join('\n');
}

/** Default gateway call against the LiteLLM `/chat/completions` endpoint. */
const defaultGatewayCall: GatewayCall = async (prompt, signal) => {
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY_DEV || process.env.LITELLM_API_KEY_STG;
  if (!baseUrl || !apiKey) throw new Error('gateway_unconfigured');
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a Cube.js performance engineer. Be concise and concrete.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`gateway_${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('empty_response');
  return content;
};

// Per-id suggestion cache — re-opening the panel never re-calls the gateway.
const cache = new Map<number, SuggestOk>();
// Per-admin token bucket (sub → {count, windowStart}).
const buckets = new Map<string, { count: number; windowStart: number }>();

/** Test-only: clear cache + rate-limit state. */
export function __resetLlmSuggesterState(): void {
  cache.clear();
  buckets.clear();
}

function rateLimited(actorSub: string, now: number): boolean {
  const b = buckets.get(actorSub);
  if (!b || now - b.windowStart >= 60_000) {
    buckets.set(actorSub, { count: 1, windowStart: now });
    return false;
  }
  if (b.count >= RATE_LIMIT_PER_MIN) return true;
  b.count += 1;
  return false;
}

export interface SuggestOpts {
  id: number;
  actorSub: string;
  /** Injectable gateway call (tests) + clock. */
  gateway?: GatewayCall;
  now?: number;
}

/**
 * Generate (or return cached) an LLM remedy. Never throws — returns a graceful
 * `{error}` the route surfaces as a non-blocking notice.
 */
export async function suggestViaLlm(
  verdict: Verdict,
  shape: QueryShape,
  opts: SuggestOpts,
): Promise<SuggestResult> {
  const cached = cache.get(opts.id);
  if (cached) return cached;

  const now = opts.now ?? Date.now();
  if (rateLimited(opts.actorSub, now)) return { error: 'rate_limited' };

  const gateway = opts.gateway ?? defaultGatewayCall;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const suggestion = await gateway(buildLlmPrompt(verdict, shape), ctl.signal);
    const ok: SuggestOk = { suggestion, lane: 'gateway' };
    cache.set(opts.id, ok);
    return ok;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { error: 'llm_timeout' };
    return { error: err instanceof Error ? err.message : 'llm_error' };
  } finally {
    clearTimeout(timer);
  }
}
