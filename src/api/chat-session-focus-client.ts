/**
 * Phase 03 — client for the chat-service session-focus inspection + reset
 * endpoints.
 *
 *   GET    /api/chat/sessions/:id/focus      → { focus, hasSdkResume }
 *   DELETE /api/chat/sessions/:id/focus      → 204 No Content
 *
 * Defensive: GET errors return `null` so the chat-header chip silently hides
 * itself when the session id is missing or the service is down. DELETE
 * returns `false` instead of throwing.
 */
import { getOwnerId } from './chat-owner-id';

/** Slot value plus the user's original phrasing that produced it. */
export interface SlotMemoryClient<T> {
  value: T;
  phrase?: string;
}

export interface TimeRangeValueClient {
  dateRange: string | [string, string];
  granularity?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export interface EntityValueClient {
  cube: string;
  pk: string;
}

export type QueryIntentSlot = 'aggregate' | 'leaderboard' | 'trend' | 'comparison';

/** Session focus bag mirror — must match chat-service SessionFocus shape. */
export interface SessionFocusClient {
  skill?: SlotMemoryClient<string>;
  concept?: SlotMemoryClient<string>;
  artifactRef?: SlotMemoryClient<string>;
  metric?: SlotMemoryClient<string>;
  dimension?: SlotMemoryClient<string>;
  timeRange?: SlotMemoryClient<TimeRangeValueClient>;
  segment?: SlotMemoryClient<string>;
  filters?: Record<string, SlotMemoryClient<string>>;
  intent?: SlotMemoryClient<QueryIntentSlot>;
  entity?: SlotMemoryClient<EntityValueClient>;
  updatedAt?: number;
}

export interface SessionFocusSnapshot {
  focus: SessionFocusClient;
  hasSdkResume: boolean;
}

function authHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Owner-Id': getOwnerId(),
  };
}

export async function getSessionFocus(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionFocusSnapshot | null> {
  if (!sessionId) return null;
  try {
    const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/focus`, {
      headers: authHeaders(),
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as SessionFocusSnapshot;
  } catch {
    return null;
  }
}

export async function deleteSessionFocus(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  try {
    const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/focus`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
