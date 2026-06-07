/**
 * Bulk restore / hard-purge helper for the /dev/chat-audit session list.
 * Issues per-id requests in parallel and aggregates the result so the caller
 * can surface a single status (count succeeded + first failure message).
 */
import { chatHeaders } from '../../api/chat-auth-headers';

export type BulkSessionAction = 'restore' | 'purge';

export interface BulkSessionResult {
  ok: number;
  failed: Array<{ id: string; message: string }>;
}

export async function runBulkSessionAction(
  ids: string[],
  action: BulkSessionAction,
): Promise<BulkSessionResult> {
  const headers = chatHeaders();
  const results = await Promise.allSettled(
    ids.map((id) => {
      const url =
        action === 'restore'
          ? `/api/chat/debug/sessions/${encodeURIComponent(id)}/restore`
          : `/api/chat/debug/sessions/${encodeURIComponent(id)}`;
      const method = action === 'restore' ? 'POST' : 'DELETE';
      return fetch(url, { method, headers }).then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return id;
      });
    }),
  );
  const failed: Array<{ id: string; message: string }> = [];
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok += 1;
    else failed.push({ id: ids[i], message: (r.reason as Error).message });
  });
  return { ok, failed };
}
