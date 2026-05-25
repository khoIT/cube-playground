/**
 * langfuse-client.ts — factory that returns a configured Langfuse client
 * or null when credentials are absent / construction fails.
 *
 * Isolated here so the tracer itself never imports Langfuse directly — the
 * null-return forms the entire disabled-path contract.
 */

import { Langfuse } from 'langfuse';
import { config, isLangfuseEnabled } from '../config.js';

export type { Langfuse };

/**
 * Returns a ready-to-use Langfuse client, or null when:
 *   - LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are absent
 *   - SDK construction throws (invalid host URL, etc.)
 *
 * Callers must treat null as "disabled" and short-circuit all SDK calls.
 */
export function createLangfuseClient(): Langfuse | null {
  if (!isLangfuseEnabled()) return null;

  try {
    return new Langfuse({
      publicKey: config.langfusePublicKey,
      secretKey: config.langfuseSecretKey,
      baseUrl: config.langfuseBaseUrl,
      // Silence SDK-level console output in production — errors surface via
      // try/catch in the tracer rather than noisy console.error calls.
      flushAt: 15,
      flushInterval: 10_000,
    });
  } catch (err) {
    console.warn('[LangfuseClient] SDK construction failed — tracing disabled:', err);
    return null;
  }
}
