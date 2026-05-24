/**
 * Fire-and-forget client for chat audit events.
 * Failures are logged-only; never throw so UI flows aren't blocked.
 */
import { getOwnerId } from './chat-owner-id';

export interface ChatAuditEvent {
  kind: string;
  sessionId?: string;
  turnId?: string;
  detail?: Record<string, unknown>;
}

export function postChatAudit(event: ChatAuditEvent): void {
  void fetch('/api/chat/audit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Id': getOwnerId(),
    },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch((err) => {
    if (typeof console !== 'undefined') {
      console.warn('[chat-audit] failed', event.kind, err);
    }
  });
}
