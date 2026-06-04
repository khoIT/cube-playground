/**
 * Client for the Settings → Chat "Remembered defaults" backend.
 *   GET    /api/chat/user-prefs?gameId=...
 *   DELETE /api/chat/user-prefs/:slot?gameId=...
 *   DELETE /api/chat/user-prefs?gameId=...
 *
 * Defensive: GET returns empty on transient failures rather than throwing,
 * matching the chat-notifications-client pattern.
 */
import { chatHeaders } from './chat-auth-headers';

export interface RememberedDefaultRow {
  slot: string;
  value: unknown;
  phrase?: string;
  label: string;
  lastUsedAt: number;
  hitCount: number;
}

function authHeaders(cubeToken?: string | null): Record<string, string> {
  return chatHeaders(
    cubeToken
      ? { Accept: 'application/json', 'X-Cube-Token': cubeToken }
      : { Accept: 'application/json' },
  );
}

export async function listRememberedDefaults(
  gameId: string,
  cubeToken?: string | null,
  signal?: AbortSignal,
): Promise<RememberedDefaultRow[]> {
  if (!gameId) return [];
  try {
    const res = await fetch(
      `/api/chat/user-prefs?gameId=${encodeURIComponent(gameId)}`,
      { headers: authHeaders(cubeToken), cache: 'no-store', signal },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: RememberedDefaultRow[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}

export async function deleteRememberedDefault(
  gameId: string,
  slot: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/chat/user-prefs/${encodeURIComponent(slot)}?gameId=${encodeURIComponent(gameId)}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteAllRememberedDefaults(gameId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/chat/user-prefs?gameId=${encodeURIComponent(gameId)}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    return res.ok;
  } catch {
    return false;
  }
}
