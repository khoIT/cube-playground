/**
 * Workability gates for pregenerated starter questions — used by
 * pregenerate-starter-questions.ts so every question that ships in the seed
 * is proven to work end-to-end BEFORE it is frozen, instead of being fixed
 * by hand after a stakeholder clicks a dead chip.
 *
 * Two tiers:
 *   cheapVerify      — compose the clicked-chip pass-through query
 *                      (buildStarterQuery) and execute it via the preview
 *                      handler; pass = rowCount > 0. Kills missing-member /
 *                      no-measure / empty-data questions for the cost of one
 *                      Cube query.
 *   verifyViaChatTurn — POST /agent/turn against the RUNNING chat-service
 *                      (candidate must already be in the loaded seed so the
 *                      pass-through fires) and read the SSE stream; pass =
 *                      ≥1 query_artifact event and a clean `done` (no error,
 *                      no timeout). This is the same path a real click takes.
 *
 * Verification sessions are KEPT under the dedicated verifier owner (they
 * never appear in a user's sidebar) so the review UI can link each report
 * row to its full transcript.
 */

import { handler as previewHandler } from '../tools/preview-cube-query.js';
import { buildStarterQuery } from '../tools/disambiguate-starter-passthrough.js';
import type { StarterQuestion } from '../db/starter-questions-store.js';
import type { ToolContext } from '../types.js';

// ---------------------------------------------------------------------------
// Tier 1 — pass-through query composition + preview execution
// ---------------------------------------------------------------------------

export interface CheapVerifyResult {
  ok: boolean;
  /** Failure stage for the report; undefined when ok. */
  reason?: 'not-composable' | 'query-error' | 'empty-result';
  detail?: string;
  rowCount?: number;
  /** The composed pass-through query — surfaced in the verification report. */
  query?: unknown;
}

export async function cheapVerify(
  question: StarterQuestion,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
  knownMembers: Set<string>,
  coverage: Record<string, string>,
  ctx: ToolContext,
): Promise<CheapVerifyResult> {
  const hit = buildStarterQuery(question, coverage, meta, knownMembers);
  if (!hit) {
    return { ok: false, reason: 'not-composable', detail: 'missing member or no measure among targets' };
  }
  try {
    // The handler re-validates via zod; the cast bridges CubeQuery's wider
    // `order` union to the handler's input shape.
    const out = (await previewHandler(
      { query: hit.query } as Parameters<typeof previewHandler>[0],
      ctx,
    )) as
      | { rows?: unknown[]; rowCount?: number }
      | string;
    if (typeof out === 'string') {
      // The preview handler returns error text for Cube /load failures.
      return { ok: false, reason: 'query-error', detail: out.slice(0, 200), query: hit.query };
    }
    const rowCount = out.rowCount ?? out.rows?.length ?? 0;
    // A single all-zero/null row is the empty-aggregate shape Cube returns
    // for "no data in range" on some cubes — treat it as empty.
    if (rowCount === 0) return { ok: false, reason: 'empty-result', rowCount, query: hit.query };
    if (rowCount === 1 && Array.isArray(out.rows) && out.rows[0] && isAllZeroOrNull(out.rows[0] as Record<string, unknown>)) {
      return { ok: false, reason: 'empty-result', detail: 'single all-zero row', rowCount, query: hit.query };
    }
    return { ok: true, rowCount, query: hit.query };
  } catch (err) {
    return { ok: false, reason: 'query-error', detail: (err as Error).message.slice(0, 200), query: hit.query };
  }
}

function isAllZeroOrNull(row: Record<string, unknown>): boolean {
  const values = Object.values(row);
  return values.length > 0 && values.every((v) => v === null || v === 0 || v === '0');
}

// ---------------------------------------------------------------------------
// Tier 2 — real chat turn over SSE
// ---------------------------------------------------------------------------

export interface SseSummary {
  sessionId: string | null;
  artifactCount: number;
  /** Tool names invoked during the turn (diagnostics for the report). */
  toolCalls: string[];
  sawDone: boolean;
  errorMessage: string | null;
}

/**
 * Fold a raw text/event-stream body into the few facts the gate needs.
 * Pure — unit-testable without a server.
 */
export function summariseSseText(raw: string): SseSummary {
  const summary: SseSummary = {
    sessionId: null,
    artifactCount: 0,
    toolCalls: [],
    sawDone: false,
    errorMessage: null,
  };
  // Frames are "event: <type>\ndata: <json>\n\n".
  for (const frame of raw.split('\n\n')) {
    const eventMatch = frame.match(/^event: (.+)$/m);
    const dataMatch = frame.match(/^data: (.+)$/m);
    if (!eventMatch) continue;
    const type = eventMatch[1].trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;
    if (dataMatch) {
      try { data = JSON.parse(dataMatch[1]); } catch { /* non-JSON data — ignore */ }
    }
    if (type === 'session_created' && data?.id) summary.sessionId = data.id;
    else if (type === 'query_artifact') summary.artifactCount += 1;
    else if (type === 'tool_call' && data?.name) summary.toolCalls.push(data.name);
    else if (type === 'done') summary.sawDone = true;
    else if (type === 'error') summary.errorMessage = String(data?.message ?? data?.error ?? 'unknown error');
  }
  return summary;
}

export interface TurnVerifyOptions {
  /** Chat-service base, e.g. http://localhost:3005 */
  baseUrl: string;
  game: string;
  workspace: string;
  ownerId: string;
  /** Hard client-side cap; the server's own turn budget is ~240s. */
  timeoutMs?: number;
}

export interface TurnVerifyResult {
  ok: boolean;
  reason?: 'no-artifact' | 'turn-error' | 'http-error' | 'client-timeout';
  detail?: string;
  /**
   * True when the failure is environmental (gateway 403/429, connection
   * refused) rather than a property of the question. The caller must NOT
   * count these against the candidate or feed them back to the LLM —
   * abort the run and fix the environment instead.
   */
  infrastructure?: boolean;
  artifactCount: number;
  toolCalls: string[];
  sessionId: string | null;
  ms: number;
}

/** Environmental failure patterns — gateway auth/quota, dead service. */
const INFRA_ERROR_RE = /403|429|authenticat|ECONNREFUSED|fetch failed/i;

export async function verifyViaChatTurn(
  questionText: string,
  opts: TurnVerifyOptions,
): Promise<TurnVerifyResult> {
  const started = Date.now();
  // Server turn budget is ~240s; 270s leaves margin without ever waiting on a
  // hung turn for long (a 20-min zombie turn cost a whole run once).
  const timeoutMs = opts.timeoutMs ?? 270_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The abort signal alone is not enough: undici may only notice it on the
  // next received chunk, and a hung turn sends nothing for minutes. Racing a
  // hard timer guarantees the gate returns on schedule regardless.
  const hardTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new HardTimeoutError()), timeoutMs + 5_000).unref?.();
  });

  let raw = '';
  let collected = ''; // partial stream salvaged for session-id cleanup
  try {
    const res = await fetch(`${opts.baseUrl}/agent/turn`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // Queries run server-authoritative through the playground proxy; any
        // non-empty token satisfies the header guard.
        'X-Cube-Token': 'starter-verify',
        // A cached replay would "verify" without exercising the live path.
        'X-Bypass-Cache': '1',
        'X-Cube-Game': opts.game,
        'X-Owner-Id': opts.ownerId,
        'X-Cube-Workspace': opts.workspace,
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: opts.ownerId,
        game: opts.game,
        message: questionText,
      }),
    });
    if (!res.ok || !res.body) {
      const detail = `HTTP ${res.status}`;
      return {
        ok: false, reason: 'http-error', detail,
        infrastructure: INFRA_ERROR_RE.test(detail),
        artifactCount: 0, toolCalls: [], sessionId: null, ms: Date.now() - started,
      };
    }
    raw = await Promise.race([
      res.text().then((t) => { collected = t; return t; }),
      hardTimeout,
    ]);
  } catch (err) {
    const timedOut = err instanceof HardTimeoutError || (err as Error).name === 'AbortError';
    const detail = timedOut
      ? `no done event within ${timeoutMs}ms`
      : (err as Error).message.slice(0, 200);
    return {
      ok: false,
      reason: timedOut ? 'client-timeout' : 'http-error',
      detail,
      infrastructure: !timedOut && INFRA_ERROR_RE.test(detail),
      artifactCount: 0, toolCalls: [],
      sessionId: summariseSseText(collected).sessionId,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }

  const s = summariseSseText(raw);
  const base = {
    artifactCount: s.artifactCount,
    toolCalls: s.toolCalls,
    sessionId: s.sessionId,
    ms: Date.now() - started,
  };
  if (s.errorMessage) {
    return {
      ok: false, reason: 'turn-error', detail: s.errorMessage.slice(0, 200),
      infrastructure: INFRA_ERROR_RE.test(s.errorMessage),
      ...base,
    };
  }
  if (!s.sawDone) return { ok: false, reason: 'turn-error', detail: 'stream ended without done event', ...base };
  if (s.artifactCount === 0) return { ok: false, reason: 'no-artifact', detail: 'turn completed but produced no query artifact', ...base };
  return { ok: true, ...base };
}

class HardTimeoutError extends Error {
  constructor() { super('hard timeout'); }
}

