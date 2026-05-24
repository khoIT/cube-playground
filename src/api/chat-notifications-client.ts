/**
 * Client for chat-service notifications proxy.
 *   GET  /api/chat/notifications
 *   POST /api/chat/notifications/:id/read
 *
 * Defensive: never throws on transient failures (returns empty list);
 * the bell badge should silently zero out rather than redden on outage.
 */
import { getOwnerId } from './chat-owner-id';

export interface ChatNotification {
  id: string;
  kind: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface ChatNotificationsListResult {
  items: ChatNotification[];
  unread: number;
}

export async function listChatNotifications(opts: {
  unreadOnly?: boolean;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<ChatNotificationsListResult> {
  const params = new URLSearchParams();
  if (opts.unreadOnly) params.set('unread', '1');
  if (opts.limit) params.set('limit', String(opts.limit));
  try {
    const res = await fetch(`/api/chat/notifications?${params.toString()}`, {
      headers: { Accept: 'application/json', 'X-Owner-Id': getOwnerId() },
      cache: 'no-store',
      signal: opts.signal,
    });
    if (!res.ok) return { items: [], unread: 0 };
    return (await res.json()) as ChatNotificationsListResult;
  } catch {
    return { items: [], unread: 0 };
  }
}

export async function markChatNotificationRead(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chat/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      headers: { 'X-Owner-Id': getOwnerId() },
    });
    return res.ok;
  } catch {
    return false;
  }
}
