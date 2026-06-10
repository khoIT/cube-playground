/**
 * Metric-resolution eval runner for cfm_vn.
 *
 * Drives each corpus question through a real /agent/turn call (same path as a
 * user click) using the existing verifyViaChatTurn SSE driver from the
 * verify-starter-question-workability script. Captures resolved metrics,
 * backing cubes, and emitted query JSON from the SSE stream.
 *
 * Usage (host process — subscription lane needs the token in env):
 *   ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN_VY=<token> \
 *   tsx test/metric-resolution-eval/metric-resolution-runner.ts
 *
 * Output: writes/overwrites test/metric-resolution-eval/cfm-vn-baseline-snapshot.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { summariseSseText } from '../../src/scripts/verify-starter-question-workability.js';
import type { EvalCorpus, EvalCase, BaselineSnapshot, BaselineResult } from './types.js';

const __dir = dirname(fileURLToPath(import.meta.url));

const CHAT_BASE = process.env['CHAT_SERVICE_URL'] ?? 'http://localhost:3005';
const GAME = 'cfm_vn';
const WORKSPACE = process.env['CUBE_WORKSPACE'] ?? 'local';
const OWNER_ID = 'eval-baseline-runner';

/** Switch chat-service to subscription lane before the batch. */
async function setSubscriptionLane(): Promise<void> {
  const secret = process.env['INTERNAL_SECRET'] ?? '';
  const url = `${CHAT_BASE}/internal/llm-auth-mode`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Id': OWNER_ID,
        ...(secret ? { 'x-internal-secret': secret } : {}),
      },
      body: JSON.stringify({ mode: 'subscription' }),
    });
    if (!res.ok) {
      console.warn(`[runner] /internal/llm-auth-mode PUT returned ${res.status} — continuing anyway`);
    } else {
      console.log('[runner] LLM auth mode set to subscription');
    }
  } catch (err) {
    console.warn('[runner] Could not reach /internal/llm-auth-mode:', (err as Error).message);
  }
}

/** Extract all SSE frames of the given event type with parsed data. */
function extractEvents(rawSse: string, eventType: string): unknown[] {
  const results: unknown[] = [];
  for (const frame of rawSse.split('\n\n')) {
    const eventMatch = frame.match(/^event: (.+)$/m);
    const dataMatch = frame.match(/^data: (.+)$/m);
    if (!eventMatch || eventMatch[1].trim() !== eventType) continue;
    if (!dataMatch) continue;
    try {
      results.push(JSON.parse(dataMatch[1]));
    } catch {
      // malformed data line — skip
    }
  }
  return results;
}

/** Extract query artifacts from raw SSE text. */
function extractArtifacts(rawSse: string): unknown[] {
  return extractEvents(rawSse, 'query_artifact');
}

/**
 * Try to recover the resolved metric id from tool_call events when the
 * artifact's sourceRef is absent (agent used source='raw'). Looks for a
 * get_business_metric call whose input.id is present.
 */
function extractMetricIdFromToolCalls(rawSse: string): string | null {
  // tool_call event shape: { id, name, args }
  const calls = extractEvents(rawSse, 'tool_call');
  for (const call of calls) {
    const c = call as Record<string, unknown>;
    if (c['name'] === 'get_business_metric') {
      const args = c['args'] as Record<string, unknown> | undefined;
      if (typeof args?.['id'] === 'string') return args['id'];
    }
  }
  return null;
}

/** Capture raw SSE text directly — verifyViaChatTurn discards the body after parsing. */
async function fetchTurnRaw(question: string, timeoutMs: number): Promise<{ raw: string; httpStatus: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${CHAT_BASE}/agent/turn`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Cube-Token': 'eval-runner',
        'X-Bypass-Cache': '1',
        'X-Cube-Game': GAME,
        'X-Owner-Id': OWNER_ID,
        'X-Cube-Workspace': WORKSPACE,
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: OWNER_ID,
        game: GAME,
        message: question,
      }),
    });
    const raw = res.ok ? await res.text() : '';
    return { raw, httpStatus: res.status };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    console.warn(`[runner] fetch error for "${question.slice(0, 40)}": ${(err as Error).message}`);
    return { raw: '', httpStatus: aborted ? 408 : 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function runCase(c: EvalCase): Promise<BaselineResult> {
  const timeoutMs = 270_000;
  console.log(`  [${c.id}] "${c.question.slice(0, 60)}"`);

  const { raw, httpStatus } = await fetchTurnRaw(c.question, timeoutMs);
  const summary = summariseSseText(raw);
  const artifacts = extractArtifacts(raw);

  // Extract resolved metric id from tool calls (disambiguate_query typically
  // names the resolved metric via the get_business_metric tool call detail).
  // The query artifact's sourceRef.id is the canonical resolved metric id.
  let resolvedMetricId: string | null = null;
  let resolvedCube: string | null = null;
  let emittedQueries: unknown[] = [];

  for (const artifact of artifacts) {
    const a = artifact as Record<string, unknown>;
    // sourceRef.id carries the metric id when source = 'business-metric'
    if (a['sourceRef'] && typeof (a['sourceRef'] as Record<string, unknown>)['id'] === 'string') {
      resolvedMetricId = (a['sourceRef'] as Record<string, unknown>)['id'] as string;
    }
    if (a['query']) {
      emittedQueries.push(a['query']);
      // Infer cube from the first measure's prefix
      const q = a['query'] as Record<string, unknown>;
      const measures = q['measures'] as string[] | undefined;
      if (measures && measures.length > 0) {
        resolvedCube = measures[0]!.split('.')[0] ?? null;
      }
    }
  }

  // Fallback: recover metric id from get_business_metric tool call when
  // the artifact was emitted with source='raw' (no sourceRef).
  if (!resolvedMetricId) {
    resolvedMetricId = extractMetricIdFromToolCalls(raw);
  }

  const status: BaselineResult['status'] = httpStatus !== 200
    ? 'http-error'
    : summary.errorMessage
      ? 'turn-error'
      : !summary.sawDone
        ? 'turn-error'
        : summary.artifactCount === 0
          ? 'no-artifact'
          : 'ok';

  return {
    caseId: c.id,
    question: c.question,
    status,
    httpStatus,
    errorDetail: summary.errorMessage ?? undefined,
    toolCalls: summary.toolCalls,
    artifactCount: summary.artifactCount,
    resolvedMetricId,
    resolvedCube,
    emittedQueries,
    sessionId: summary.sessionId,
    capturedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const corpusPath = join(__dir, 'cfm-vn-eval-corpus.json');
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as EvalCorpus;

  console.log(`[runner] Loaded ${corpus.cases.length} cases from corpus`);
  console.log(`[runner] Target: ${CHAT_BASE} | game=${GAME} | workspace=${WORKSPACE}`);

  await setSubscriptionLane();

  const results: BaselineResult[] = [];
  for (const c of corpus.cases) {
    const result = await runCase(c);
    results.push(result);
    // Brief summary per case
    const indicator = result.status === 'ok' ? '✓' : '✗';
    const metric = result.resolvedMetricId ?? '(none)';
    const cube = result.resolvedCube ?? '(none)';
    console.log(`    ${indicator} metric=${metric} cube=${cube} artifacts=${result.artifactCount}`);
  }

  const snapshot: BaselineSnapshot = {
    capturedAt: new Date().toISOString(),
    gameId: GAME,
    workspace: WORKSPACE,
    chatBase: CHAT_BASE,
    corpusVersion: corpus.capturedAt,
    results,
  };

  // Default writes baseline; set SNAPSHOT_OUT env to write a re-run file instead
  const outPath = process.env['SNAPSHOT_OUT']
    ? resolve(process.env['SNAPSHOT_OUT'])
    : join(__dir, 'cfm-vn-baseline-snapshot.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\n[runner] Baseline snapshot written → ${outPath}`);

  const ok = results.filter((r) => r.status === 'ok').length;
  const total = results.length;
  console.log(`[runner] ${ok}/${total} cases produced artifacts`);
}

main().catch((err) => {
  console.error('[runner] Fatal:', err);
  process.exit(1);
});
