/**
 * Server → chat-service notification bridge.
 *
 * POSTs to POST /internal/notifications on the chat-service, which is gated by
 * the shared INTERNAL_SECRET and calls InAppNotificationDriver.send(). This
 * keeps all notification persistence in the chat-service DB — the server never
 * writes to chat.db directly.
 *
 * Graceful degradation: on ANY error (network, misconfigured secret, chat-service
 * down) the call resolves without throwing. The anomaly detector + digest runner
 * MUST not break when the notification bridge is unavailable.
 */

function chatServiceUrl(): string {
  return process.env.CHAT_SERVICE_URL ?? 'http://localhost:3005';
}

export interface SendNotificationInput {
  /** Recipient — the owner_id stored in chat.db. */
  ownerId: string;
  /** Free-form classifier, e.g. 'anomaly_alert', 'alert_rule_breach', 'digest'. */
  kind: string;
  /** Structured payload; stored as JSON in the notifications table. */
  payload: unknown;
}

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Fire-and-forget notification to chat-service. Returns true on success, false
 * on any failure. Callers must NOT await in a way that blocks the cron tick —
 * wrap the call in a try/catch when using from a loop.
 */
export async function sendNotification(
  input: SendNotificationInput,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean> {
  const secret = process.env.INTERNAL_SECRET ?? '';
  if (!secret) {
    // Silently skip: INTERNAL_SECRET not configured in this environment.
    // Log once so ops notices during setup, but don't spam on every tick.
    console.warn('[notify-client] INTERNAL_SECRET not configured; skipping notification');
    return false;
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await doFetch(`${chatServiceUrl()}/internal/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify(input),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[notify-client] POST /internal/notifications returned ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[notify-client] notification failed: ${msg}`);
    return false;
  }
}
