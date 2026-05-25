/**
 * Client for the Settings → Chat "Remembered defaults" backend.
 *   GET    /api/chat/user-prefs?gameId=...
 *   DELETE /api/chat/user-prefs/:slot?gameId=...
 *   DELETE /api/chat/user-prefs?gameId=...
 *
 * Defensive: GET returns empty on transient failures rather than throwing,
 * matching the chat-notifications-client pattern.
 */
import { getOwnerId } from './chat-owner-id';

export interface RememberedDefaultRow {
  slot: string;
  value: unknown;
  phrase?: string;
  label: string;
  lastUsedAt: number;
  hitCount: number;
}

function authHeaders(cubeToken?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'X-Owner-Id': getOwnerId(),
  };
  if (cubeToken) h['X-Cube-Token'] = cubeToken;
  return h;
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
