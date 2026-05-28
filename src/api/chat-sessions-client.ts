/**
 * Chat sessions REST client — DELETE / future PATCH operations.
 * SSE turn streaming lives in chat-sse-client; this file holds the plain
 * fetch helpers used by row actions (delete, rename later).
 */
import { getOwnerId } from './chat-owner-id';
import { getActiveWorkspaceId, WORKSPACE_HEADER } from '../components/workspace-context';

export async function deleteChatSession(id: string): Promise<void> {
  const headers: Record<string, string> = { 'X-Owner-Id': getOwnerId() };
  const wsId = getActiveWorkspaceId();
  if (wsId) headers[WORKSPACE_HEADER] = wsId;
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to delete conversation: ${text || res.statusText}`);
  }
}
