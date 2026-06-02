/**
 * Classifies a raw LLM/agent failure into an actionable category so the chat
 * UI and the audit log can tell the user *where to fix* instead of surfacing an
 * opaque "API Error: 403 Forbidden".
 *
 * Two failure routes feed this:
 *   1. Thrown errors from the agent subprocess (gateway unreachable, crash) —
 *      the message often carries appended `claude stderr: …`.
 *   2. SDK `result` messages with a non-success subtype, whose `result` text is
 *      something like "Failed to authenticate. API Error: 403 Forbidden".
 *
 * Matching is text-based and order-sensitive (most specific first). Keep it
 * dependency-free so it can be unit-tested without the SDK.
 */

export interface ClassifiedError {
  /** Machine-readable category. Stored in chat_audit + sent over SSE. */
  code: string;
  /** Short human-facing headline. */
  title: string;
  /** Actionable guidance — what the user/operator should check. */
  hint: string;
  /** True when retrying may succeed without intervention (transient). */
  retriable: boolean;
}

interface ErrorRule {
  code: string;
  title: string;
  hint: string;
  retriable: boolean;
  /** Matches against the lowercased message+subtype haystack. */
  test: (haystack: string) => boolean;
}

const has =
  (...needles: string[]) =>
  (h: string): boolean =>
    needles.some((n) => h.includes(n));

// Order matters: the first matching rule wins. List specific signals before
// broad ones (e.g. 401 before a bare "forbidden").
const RULES: ErrorRule[] = [
  {
    code: 'llm_unauthorized',
    title: 'AI service rejected the credentials (401)',
    hint: 'The API key is invalid or expired. Update ANTHROPIC_API_KEY in the chat-service environment.',
    retriable: false,
    test: has('401', 'unauthorized', 'invalid x-api-key', 'invalid api key', 'authentication_error'),
  },
  {
    code: 'llm_gateway_forbidden',
    title: 'AI service refused the request (403)',
    hint: 'The AI gateway blocked this request. If you are off the corporate network, connect to the VPN. If you are already on VPN, your IP may not be allow-listed on the gateway, or the API key may be wrong.',
    retriable: false,
    test: has('403', 'forbidden', 'failed to authenticate'),
  },
  {
    code: 'llm_rate_limited',
    title: 'AI service rate limit (429)',
    hint: 'Too many requests in a short window. Wait a few seconds and try again.',
    retriable: true,
    test: has('429', 'rate limit', 'rate_limit', 'too many requests'),
  },
  {
    code: 'llm_unreachable',
    title: 'Cannot reach the AI service',
    hint: 'The network call to the AI gateway failed. Check your VPN/connection (ANTHROPIC_BASE_URL), then retry.',
    retriable: true,
    test: has(
      'econnrefused',
      'enotfound',
      'etimedout',
      'eai_again',
      'fetch failed',
      'network error',
      'socket hang up',
      'connect timeout',
      'getaddrinfo',
    ),
  },
  {
    code: 'llm_model_unavailable',
    title: 'Requested model is unavailable',
    hint: 'The configured model is not served by the gateway. Check the chat-service model configuration.',
    retriable: false,
    test: has('model not found', 'does not exist', 'invalid model', 'model_not_found', 'unknown model'),
  },
  {
    code: 'llm_server_error',
    title: 'AI service error',
    hint: 'The AI gateway returned a server error. This is usually transient — retry shortly.',
    retriable: true,
    test: has('500', '502', '503', '504', 'internal server error', 'bad gateway', 'service unavailable'),
  },
];

const FALLBACK: ClassifiedError = {
  code: 'agent_error',
  title: 'The assistant hit an unexpected error',
  hint: 'Try again. If it keeps failing, check the chat-service logs or the DevAudit triage view for the underlying cause.',
  retriable: true,
};

/**
 * Classify a raw failure. `message` is the primary signal; `subtype` (the SDK
 * result subtype, when present) is folded in to widen the match surface.
 */
export function classifyLlmError(input: { message?: string | null; subtype?: string | null }): ClassifiedError {
  const haystack = `${input.message ?? ''} ${input.subtype ?? ''}`.toLowerCase();
  const rule = RULES.find((r) => r.test(haystack));
  if (!rule) return { ...FALLBACK };
  return { code: rule.code, title: rule.title, hint: rule.hint, retriable: rule.retriable };
}
