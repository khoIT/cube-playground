/**
 * Server-side client for the chat-service LLM auth-mode bridge
 * (`GET/PUT /internal/llm-auth-mode`). Lets the admin hub read and switch
 * which credential lane the chat agent uses: gateway API keys vs the Claude
 * subscription OAuth token.
 *
 * Mirrors chat-cost-client.ts: explicit timeout, secret header, and graceful
 * null on any failure for GET. PUT distinguishes a chat-service 400
 * (mode not configured — surfaced to the admin) from transport failure (null).
 */

export type LlmAuthMode =
  | 'auto'
  | 'gateway'
  | 'subscription'
  | 'subscription-vy'
  | 'subscription-thi';

export interface LlmAuthStatus {
  mode: LlmAuthMode;
  keys: {
    mode: LlmAuthMode;
    active: string;
    configured: string[];
    exhausted: string[];
  };
  /** Global model override applied to every turn (null = honour per-user header). */
  modelOverride: string | null;
  /** Model ids the override (and per-user X-Model) may select. */
  allowedModels: string[];
  /** Server default model used when no override is set. */
  defaultModel: string;
}

export interface SetLlmAuthModeResult {
  ok: boolean;
  /** Populated on ok=true. */
  status?: LlmAuthStatus;
  /** chat-service rejection reason (e.g. subscription token not configured). */
  errorMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 3_000;

function chatServiceUrl(): string {
  return process.env.CHAT_SERVICE_URL ?? 'http://localhost:3005';
}

interface ClientOpts {
  timeoutMs?: number;
  /** Test seam — override the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Current auth mode + key ladder status. Null (never throws) on any failure. */
export async function fetchLlmAuthStatus(opts: ClientOpts = {}): Promise<LlmAuthStatus | null> {
  const secret = process.env.INTERNAL_SECRET ?? '';
  if (!secret) return null;

  const doFetch = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(`${chatServiceUrl()}/internal/llm-auth-mode`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-internal-secret': secret },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as LlmAuthStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PUT a partial change (mode and/or model) to the chat-service. ok=false with
 * errorMessage on a chat-service 400 (lane/model not configured); ok=false
 * without a message on transport failure/timeout.
 */
async function putLlmAuth(
  body: { mode?: LlmAuthMode; model?: string | null },
  opts: ClientOpts = {},
): Promise<SetLlmAuthModeResult> {
  const secret = process.env.INTERNAL_SECRET ?? '';
  if (!secret) return { ok: false, errorMessage: 'INTERNAL_SECRET not configured on the server' };

  const doFetch = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(`${chatServiceUrl()}/internal/llm-auth-mode`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (res.status === 400) {
      const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      return { ok: false, errorMessage: err.message ?? err.error ?? 'Change rejected by chat-service' };
    }
    if (!res.ok) return { ok: false };
    return { ok: true, status: (await res.json()) as LlmAuthStatus };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Switch which key/lane the failover ladder uses for all users. */
export async function setLlmAuthMode(
  mode: LlmAuthMode,
  opts: ClientOpts = {},
): Promise<SetLlmAuthModeResult> {
  return putLlmAuth({ mode }, opts);
}

/** Set (or clear, with null) the global chat model override applied to all users. */
export async function setLlmModelOverride(
  model: string | null,
  opts: ClientOpts = {},
): Promise<SetLlmAuthModeResult> {
  return putLlmAuth({ model }, opts);
}
