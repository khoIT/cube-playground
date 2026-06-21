/**
 * Answer-quality eval runner (Phase 03) — game-parameterized.
 *
 * Drives each question-bank case through a real /agent/turn SSE call (same path
 * as a user click) and captures the dimensions the scorer needs:
 *   - resolution: emitted cube.measure vs the case's expectedRef
 *   - non-empty:  did any emitted query return rows
 *   - answered:   did the turn emit an artifact at all (vs refuse/error)
 *   - trust:      did a trust-guard / caveat surface
 *
 * Reuses the SSE summariser from the frozen metric-resolution harness; does NOT
 * mutate that harness. Subscription lane only — run on the HOST chat-service
 * (it holds the token; Docker does not), loading INTERNAL_SECRET via --env-file
 * so the secret never appears on the command line.
 *
 *   GAME=cfm_vn LIMIT=5 GROUP=synthesized-glossary \
 *   npx tsx --env-file=../.env --env-file=../.env.local \
 *     test/eval/answer-quality-runner.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { summariseSseText } from '../../src/scripts/verify-starter-question-workability.js';
import type { EvalCorpus, EvalCase } from '../metric-resolution-eval/types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const CHAT_BASE = process.env['CHAT_SERVICE_URL'] ?? 'http://localhost:3005';
const GAME = process.env['GAME'] ?? 'cfm_vn';
const WORKSPACE = process.env['CUBE_WORKSPACE'] ?? 'local';
const OWNER_ID = 'answer-quality-eval-runner';
const LIMIT = process.env['LIMIT'] ? Number(process.env['LIMIT']) : Infinity;
const GROUP = process.env['GROUP'] ?? ''; // optional curationGroup filter
const TIMEOUT_MS = process.env['TIMEOUT_MS'] ? Number(process.env['TIMEOUT_MS']) : 270_000;

interface AqResult {
  caseId: string;
  question: string;
  curationGroup: string;
  expectedRef: string | null;
  status: 'ok' | 'no-artifact' | 'turn-error' | 'http-error';
  httpStatus: number;
  resolvedRef: string | null; // first measure of first emitted query
  resolvedCube: string | null;
  artifactCount: number;
  nonEmpty: boolean;          // any emitted query returned rows
  trustGuardSeen: boolean;    // a trust/caveat surfaced
  errorDetail?: string;
}

async function setSubscriptionLane(): Promise<void> {
  const secret = process.env['INTERNAL_SECRET'] ?? '';
  try {
    const res = await fetch(`${CHAT_BASE}/internal/llm-auth-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Id': OWNER_ID,
        ...(secret ? { 'x-internal-secret': secret } : {}) },
      body: JSON.stringify({ mode: 'subscription' }),
    });
    console.log(res.ok ? '[runner] auth lane = subscription'
      : `[runner] auth-mode PUT ${res.status} (continuing)`);
  } catch (err) {
    console.warn('[runner] auth-mode unreachable:', (err as Error).message);
  }
}

function extractEvents(raw: string, type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const frame of raw.split('\n\n')) {
    const e = frame.match(/^event: (.+)$/m);
    const d = frame.match(/^data: (.+)$/m);
    if (!e || e[1].trim() !== type || !d) continue;
    try { out.push(JSON.parse(d[1])); } catch { /* skip */ }
  }
  return out;
}

/** Heuristic: a trust caveat surfaced in assistant text or a trust event. */
function sawTrustGuard(raw: string): boolean {
  if (extractEvents(raw, 'trust_notice').length > 0) return true;
  return /\b(trust|caveat|uncertif|not certified|provisional|drift)\b/i.test(raw);
}

async function fetchTurnRaw(q: string): Promise<{ raw: string; httpStatus: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CHAT_BASE}/agent/turn`, {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Cube-Token': 'eval-runner',
        'X-Bypass-Cache': '1', 'X-Cube-Game': GAME, 'X-Owner-Id': OWNER_ID,
        'X-Cube-Workspace': WORKSPACE,
      },
      body: JSON.stringify({ session_id: null, owner_id: OWNER_ID, game: GAME, message: q }),
    });
    return { raw: res.ok ? await res.text() : '', httpStatus: res.status };
  } catch (err) {
    return { raw: '', httpStatus: (err as Error).name === 'AbortError' ? 408 : 0 };
  } finally { clearTimeout(timer); }
}

async function runCase(c: EvalCase): Promise<AqResult> {
  const { raw, httpStatus } = await fetchTurnRaw(c.question);
  const summary = summariseSseText(raw);
  const artifacts = extractEvents(raw, 'query_artifact');

  let resolvedRef: string | null = null;
  let nonEmpty = false;
  for (const a of artifacts) {
    const query = a['query'] as Record<string, unknown> | undefined;
    const measures = query?.['measures'] as string[] | undefined;
    if (!resolvedRef && measures?.length) resolvedRef = measures[0]!;
    // non-empty: the artifact's chart carries originalRowCount (rows live on the
    // chart, not the artifact root; the 'result' SSE event is final text only).
    const chart = a['chart'] as Record<string, unknown> | undefined;
    const rc = chart?.['originalRowCount'] as number | undefined;
    if (typeof rc === 'number' && rc > 0) nonEmpty = true;
  }

  const status: AqResult['status'] = httpStatus !== 200 ? 'http-error'
    : summary.errorMessage || !summary.sawDone ? 'turn-error'
    : summary.artifactCount === 0 ? 'no-artifact' : 'ok';

  return {
    caseId: c.id, question: c.question, curationGroup: c.curationGroup,
    expectedRef: c.expectedRef, status, httpStatus, resolvedRef,
    resolvedCube: resolvedRef ? resolvedRef.split('.')[0]! : null,
    artifactCount: summary.artifactCount, nonEmpty, trustGuardSeen: sawTrustGuard(raw),
    errorDetail: summary.errorMessage ?? undefined,
  };
}

async function main(): Promise<void> {
  const corpusPath = process.env['CORPUS'] ?? join(__dir, `${GAME}-question-bank.json`);
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as EvalCorpus;
  let cases = corpus.cases;
  if (GROUP) cases = cases.filter((c) => c.curationGroup === GROUP);
  if (Number.isFinite(LIMIT)) cases = cases.slice(0, LIMIT);

  console.log(`[runner] ${GAME} | ${cases.length} cases | ${CHAT_BASE} | ws=${WORKSPACE}`);
  await setSubscriptionLane();

  const results: AqResult[] = [];
  for (const c of cases) {
    const r = await runCase(c);
    results.push(r);
    const ok = r.status === 'ok' ? '✓' : '✗';
    const hit = r.expectedRef ? (r.resolvedRef === r.expectedRef ? '=' : '≠') : '·';
    console.log(`  ${ok} [${r.curationGroup}] "${c.question.slice(0, 44)}" ${hit} ${r.resolvedRef ?? '(none)'}${r.nonEmpty ? ' rows' : ''}`);
  }

  const out = process.env['SNAPSHOT_OUT']
    ? resolve(process.env['SNAPSHOT_OUT'])
    : join(__dir, `${GAME}-aq-snapshot.json`);
  writeFileSync(out, JSON.stringify({
    capturedAt: new Date().toISOString(), gameId: GAME, workspace: WORKSPACE,
    chatBase: CHAT_BASE, corpusVersion: corpus.capturedAt, results,
  }, null, 2), 'utf8');

  const okN = results.filter((r) => r.status === 'ok').length;
  const resolved = results.filter((r) => r.expectedRef && r.resolvedRef === r.expectedRef).length;
  const withGolden = results.filter((r) => r.expectedRef).length;
  console.log(`\n[runner] answered ${okN}/${results.length} · resolution ${resolved}/${withGolden} golden · → ${out}`);
}

main().catch((e) => { console.error('[runner] fatal:', e); process.exit(1); });
