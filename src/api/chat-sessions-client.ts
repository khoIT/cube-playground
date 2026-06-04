/**
 * Chat sessions REST client — DELETE + share/unshare (publish-to-team).
 * SSE turn streaming lives in chat-sse-client; this file holds the plain
 * fetch helpers used by row actions.
 */
import { chatHeaders } from './chat-auth-headers';

export async function deleteChatSession(id: string): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: chatHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to delete conversation: ${text || res.statusText}`);
  }
}

/**
 * Publish / unpublish a session to the team. Owner-only (server enforces 403
 * for non-owners). `share=true` → POST /share, `false` → POST /unshare.
 */
export async function setChatSessionShared(id: string, share: boolean): Promise<void> {
  const action = share ? 'share' : 'unshare';
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: chatHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to ${action} conversation: ${text || res.statusText}`);
  }
}
