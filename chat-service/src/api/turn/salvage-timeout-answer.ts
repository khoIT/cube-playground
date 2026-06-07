/**
 * Best-effort answer salvage for turns killed by the per-turn timeout.
 *
 * When chatTurnTimeoutMs expires the SDK stream ends without a `result`
 * message, so assistantText is empty even though the model may have done
 * minutes of real work (reasoning + tool calls). Historically that work was
 * discarded and the user saw a blank aborted turn.
 *
 * This module runs ONE bounded, tool-less LLM call that writes an answer from
 * the reasoning transcript the turn already produced. If the salvage call
 * itself times out or fails, it degrades to a deterministic notice so the
 * persisted turn is never empty. User cancels are not salvaged — the caller
 * gates on abortReason === 'timeout'.
 */

import { config } from '../../config.js';
import {
  getActiveAnthropicKey,
  reportKeyBalanceExhausted,
  isBalanceExhaustedError,
  anthropicAuthEnvFor,
} from '../../core/anthropic-key-failover.js';

// ---------------------------------------------------------------------------
// Deps (injected for testability)
// ---------------------------------------------------------------------------

export interface SalvageDeps {
  /** One-shot LLM call; returns the raw text response. */
  callLlm: (prompt: string) => Promise<string>;
}

export interface SalvageInput {
  /** The user's question for this turn. */
  question: string;
  /** Accumulated chain-of-thought captured before the abort. */
  reasoningText: string;
  /** Query artifacts already streamed to the FE (rendered separately). */
  artifactCount: number;
  /** The per-turn budget (ms) that expired — used in the notice copy. */
  timeoutMs: number;
  /** Model for the salvage call (the turn's resolved model). */
  model: string;
  logger: { warn: (obj: unknown, msg?: string) => void };
  /** Test seam; production callers omit this and get the SDK call. */
  deps?: SalvageDeps;
}

// Keep the salvage prompt bounded: the END of the reasoning carries the
// freshest findings (numbers already pulled, what's still missing), so trim
// from the front when the transcript is long.
const REASONING_TAIL_CHARS = 8_000;

// ---------------------------------------------------------------------------
// Prompt + deterministic fallback
// ---------------------------------------------------------------------------

export function buildSalvagePrompt(question: string, reasoningTail: string): string {
  return [
    'An analytics agent ran out of its time budget while researching the question below.',
    'Its partial analysis transcript follows. Write the best possible answer USING ONLY',
    'findings present in the transcript — never invent numbers. Where a step is missing',
    'or a query failed, say so explicitly in one short line. Answer in concise markdown.',
    'Start with one sentence noting this is a partial result produced under a time limit.',
    '',
    `## Question`,
    question,
    '',
    `## Partial analysis transcript`,
    reasoningTail,
  ].join('\n');
}

export function deterministicTimeoutNotice(timeoutMs: number, artifactCount: number): string {
  const minutes = Math.round(timeoutMs / 60_000);
  const artifactNote =
    artifactCount > 0
      ? ` ${artifactCount} data ${artifactCount === 1 ? 'query is' : 'queries are'} attached below with the numbers gathered so far.`
      : '';
  return (
    `⏱ **This question exceeded the ${minutes}-minute analysis budget before an answer could be written.**` +
    `${artifactNote} The partial work is preserved in the Reasoning section. ` +
    `Try narrowing the question (shorter date range, fewer breakdowns) and asking again.`
  );
}

// ---------------------------------------------------------------------------
// Default LLM dep — one-shot SDK call, failover-aware key, no tools.
// Mirrors maybe-summarise-title.ts; kept local because the salvage call uses
// the turn's model (not titleModel) and must never throw to the caller.
// ---------------------------------------------------------------------------

function defaultDeps(model: string): SalvageDeps {
  return {
    callLlm: async (prompt) => {
      const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
      const activeKey = getActiveAnthropicKey();
      let result = '';
      for await (const msg of sdkQuery({
        prompt,
        options: {
          model,
          env: {
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
          if (m.subtype && m.subtype !== 'success') {
            if (isBalanceExhaustedError(m.result ?? '')) {
              reportKeyBalanceExhausted(activeKey.key);
            }
            return ''; // empty → caller falls back to the deterministic notice
          }
          result = m.result ?? '';
        }
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------

/**
 * Returns non-empty markdown to persist as the turn's assistant text.
 * Never throws; never returns an empty string.
 */
export async function salvageTimeoutAnswer(input: SalvageInput): Promise<string> {
  const { question, reasoningText, artifactCount, timeoutMs, model, logger } = input;
  const notice = deterministicTimeoutNotice(timeoutMs, artifactCount);

  // Salvage disabled, or too little transcript to write anything useful from.
  if (config.chatTimeoutSalvageMs <= 0 || reasoningText.trim().length < 200) {
    return notice;
  }

  const deps = input.deps ?? defaultDeps(model);
  const prompt = buildSalvagePrompt(question, reasoningText.slice(-REASONING_TAIL_CHARS));

  try {
    const salvaged = await Promise.race([
      deps.callLlm(prompt),
      // Bounded: a stuck salvage call must not double the user's wait.
      new Promise<string>((resolve) =>
        setTimeout(() => resolve(''), config.chatTimeoutSalvageMs).unref?.(),
      ),
    ]);
    const text = (salvaged ?? '').trim();
    if (text) return text;
    logger.warn({ timeoutMs }, '[salvage] empty salvage response — using deterministic notice');
  } catch (err) {
    logger.warn({ err }, '[salvage] salvage call failed — using deterministic notice');
  }
  return notice;
}
