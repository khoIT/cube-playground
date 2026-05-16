/**
 * API client for the New Metric wizard write endpoint.
 * POST /api/playground/schema/write
 */

export type WriteResponse =
  | { ok: true; meta: unknown; warning?: string }
  | { ok: false; status: 409; reason: 'mtime-conflict' }
  | { ok: false; status: 504; reason: 'meta-poll-timeout' }
  | { ok: false; status: number; reason: string };

type WriteBody = {
  cubeName: string;
  measureName: string;
  yamlPatch: string;
};

/**
 * Post a new measure YAML fragment to the playground write endpoint.
 * Returns a discriminated union — callers must handle each case explicitly.
 */
export async function postSchemaWrite(body: WriteBody): Promise<WriteResponse> {
  let resp: Response;

  try {
    resp = await fetch('/api/playground/schema/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Network error';
    return { ok: false, status: 0, reason };
  }

  if (resp.ok) {
    try {
      const json = await resp.json() as { ok: true; meta: unknown; warning?: string };
      return { ok: true, meta: json.meta, warning: json.warning };
    } catch {
      return { ok: true, meta: null };
    }
  }

  // Parse error body for known status codes
  let errorBody: { ok: false; reason?: string } = { ok: false };
  try {
    errorBody = await resp.json() as { ok: false; reason?: string };
  } catch {
    // Ignore JSON parse failure — use fallback reason below
  }

  const reason = errorBody.reason ?? `HTTP ${resp.status}`;

  if (resp.status === 409) {
    return { ok: false, status: 409, reason: 'mtime-conflict' };
  }

  if (resp.status === 504) {
    return { ok: false, status: 504, reason: 'meta-poll-timeout' };
  }

  return { ok: false, status: resp.status, reason };
}

// ---------------------------------------------------------------------------
// DELETE /api/playground/schema/write — Discard flow (P5)
// ---------------------------------------------------------------------------

export type DeleteResponse =
  | { ok: true }
  | { ok: false; status: 404; reason: 'no-backup-found' }
  | { ok: false; status: number; reason: string };

type DeleteBody = {
  cubeName: string;
  measureName: string;
};

/**
 * Discard the wizard-written measure by restoring the `.bak`. Used by the
 * Discard button on step 3 and by `useLivePreview` when the measure name
 * changes (auto-Discard prior before writing the new one).
 */
export async function deleteSchemaWrite(body: DeleteBody): Promise<DeleteResponse> {
  let resp: Response;
  try {
    resp = await fetch('/api/playground/schema/write', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Network error';
    return { ok: false, status: 0, reason };
  }

  if (resp.ok) return { ok: true };

  let errorBody: { ok: false; reason?: string } = { ok: false };
  try {
    errorBody = (await resp.json()) as { ok: false; reason?: string };
  } catch {
    /* ignore */
  }
  const reason = errorBody.reason ?? `HTTP ${resp.status}`;

  if (resp.status === 404) {
    return { ok: false, status: 404, reason: 'no-backup-found' };
  }
  return { ok: false, status: resp.status, reason };
}
