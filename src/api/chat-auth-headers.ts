/**
 * Shared header builder for chat-service requests.
 *
 * Chat clients use raw fetch (not the apiFetch wrapper), so they must attach
 * the same identity headers apiFetch does — most importantly the app JWT. The
 * gateway is server-authoritative: in real-auth mode it derives the chat owner
 * from the *verified* JWT (`request.owner = claims.sub`), NOT from X-Owner-Id.
 * Without the bearer every user collapses to the `'dev'` default owner and
 * sessions leak across users.
 *
 * X-Owner-Id is still sent so the AUTH_DISABLED / legacy-test path (which has
 * no JWT) keeps a deterministic owner.
 */
import { getOwnerId } from './chat-owner-id';
import { readAppToken } from '../auth/auth-storage';
import { getActiveWorkspaceId, WORKSPACE_HEADER } from '../components/workspace-context';

/**
 * Build identity headers for a chat request and merge any caller-supplied
 * extras (Accept, Content-Type, X-Cube-Token, …) on top. Caller extras win on
 * key collisions so a call site can still override if needed.
 */
export function chatHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Owner-Id': getOwnerId(),
  };

  // Verified-identity bearer — the gateway trusts this over X-Owner-Id.
  const appToken = readAppToken();
  if (appToken) headers.Authorization = `Bearer ${appToken}`;

  // Partition chat by Cube workspace (server scopes session reads/writes by it).
  const wsId = getActiveWorkspaceId();
  if (wsId) headers[WORKSPACE_HEADER] = wsId;

  return extra ? { ...headers, ...extra } : headers;
}
