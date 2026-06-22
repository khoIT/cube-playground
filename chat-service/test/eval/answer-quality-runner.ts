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
 *
 * Full-trail capture (on by default): every run also writes a per-case trail under
 * `test/eval/runs/{game}-{group}-{timestamp}/` holding the VERBATIM SSE stream,
 * every parsed event in order, the tool trail WITH arguments, and the
 * reconstructed reasoning + streamed answer — so a run can be revisited in full
 * later, not just from the lean scorecard. The committed snapshot stays lean and
 * points at each case's trail file via `trailFile`. Env knobs:
 *   TRAIL=0    disable trail capture (lean snapshot only, pre-trail behaviour)
 *   RUN_DIR=…  override the trail archive directory for this run
 * The run dir is gitignored (raw transcripts are large + reproducible). One limit:
 * tool_result events carry the server-SUMMARISED tool output (what the FE sees),
 * not the full raw tool return — that is never streamed over SSE.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
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

// Full-trail capture. On by default; TRAIL=0 reverts to the lean-snapshot-only
// behaviour. One timestamped dir per run so runs accumulate a longitudinal trail
// instead of overwriting each other. Stamp the run once at startup.
const TRAIL_ENABLED = process.env['TRAIL'] !== '0';
const RUN_STARTED_ISO = new Date().toISOString();
const RUN_TAG = RUN_STARTED_ISO.replace(/[:.]/g, '-'); // filesystem-safe
const RUN_DIR = TRAIL_ENABLED
  ? (process.env['RUN_DIR']
      ? resolve(process.env['RUN_DIR'])
      : join(__dir, 'runs', `${GAME}-${GROUP || 'all'}-${RUN_TAG}`))
  : null;

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
  // Reporting context — what the user actually got, so the readable report can
  // show went-well / fell-short, not just a pass/fail bit.
  answerText: string | null;  // final assistant text (the user-facing answer)
  artifactTitle: string | null; // first emitted artifact's title
  toolCalls: string[];        // tools the agent invoked this turn
  latencyMs: number;          // wall-clock for the turn (slow cases = improve target)
  costUsd: number | null;     // turn cost (budget tracking)
  outputTokens: number | null;
  // Pointer (relative to this dir) to the full per-case trail — verbatim SSE,
  // ordered events, tool args. null when TRAIL=0. Lets the lean snapshot link to
  // the heavy transcript without inlining it.
  trailFile: string | null;
}

/**
 * Full per-case trail — everything the turn produced, for later forensics.
 * `rawSse` is the verbatim stream; `events` is every frame parsed in order;
 * `toolTrail` pairs each tool_call (with its arguments) to its tool_result
 * summary + latency; the two reconstructed strings are the model's reasoning and
 * the streamed user-facing answer. Written one-file-per-case under RUN_DIR.
 */
interface CaseTrail {
  caseId: string;
  question: string;
  curationGroup: string;
  expectedRef: string | null;
  httpStatus: number;
  latencyMs: number;
  capturedAt: string;
  rawSse: string;
  events: { seq: number; type: string; data: unknown }[];
  toolTrail: { name: string; args: unknown; ms: number | null; resultSummary: unknown }[];
  thinkingText: string;
  assistantText: string;
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

/** Every SSE frame parsed in arrival order — the full ordered trail. Non-JSON
 *  data is kept as a raw string rather than dropped. */
function parseAllEvents(raw: string): { seq: number; type: string; data: unknown }[] {
  const out: { seq: number; type: string; data: unknown }[] = [];
  let seq = 0;
  for (const frame of raw.split('\n\n')) {
    const e = frame.match(/^event: (.+)$/m);
    const d = frame.match(/^data: (.+)$/m);
    if (!e) continue;
    let data: unknown = null;
    if (d) { try { data = JSON.parse(d[1]!); } catch { data = d[1]!; } }
    out.push({ seq: seq++, type: e[1]!.trim(), data });
  }
  return out;
}

/** Pair each tool_call (id, name, args) with its tool_result (ms, summary) by id,
 *  preserving call order — the agent's tool trajectory with arguments. */
function buildToolTrail(
  events: { type: string; data: unknown }[],
): { name: string; args: unknown; ms: number | null; resultSummary: unknown }[] {
  const byId = new Map<string, { name: string; args: unknown; ms: number | null; resultSummary: unknown }>();
  const order: { name: string; args: unknown; ms: number | null; resultSummary: unknown }[] = [];
  for (const ev of events) {
    const d = ev.data as Record<string, unknown> | null;
    if (ev.type === 'tool_call' && typeof d?.['id'] === 'string') {
      const rec = { name: String(d['name'] ?? '?'), args: d['args'] ?? {}, ms: null as number | null, resultSummary: null as unknown };
      byId.set(d['id'], rec);
      order.push(rec);
    } else if (ev.type === 'tool_result' && typeof d?.['id'] === 'string') {
      const rec = byId.get(d['id']);
      if (rec) {
        rec.ms = typeof d['ms'] === 'number' ? (d['ms'] as number) : null;
        rec.resultSummary = d['summary'] ?? null;
      }
    }
  }
  return order;
}

/** Concatenate the `delta` payloads of one streamed channel (token | thinking)
 *  back into the full text. */
function reconstructText(events: { type: string; data: unknown }[], type: 'token' | 'thinking'): string {
  return events
    .filter((e) => e.type === type)
    .map((e) => String((e.data as Record<string, unknown> | null)?.['delta'] ?? ''))
    .join('');
}

/** Heuristic: a trust caveat surfaced in assistant text or a trust event. */
function sawTrustGuard(raw: string): boolean {
  if (extractEvents(raw, 'trust_notice').length > 0) return true;
  return /\b(trust|caveat|uncertif|not certified|provisional|drift)\b/i.test(raw);
}

async function fetchTurnRaw(q: string, ownerId: string): Promise<{ raw: string; httpStatus: number; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${CHAT_BASE}/agent/turn`, {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Cube-Token': 'eval-runner',
        'X-Bypass-Cache': '1', 'X-Cube-Game': GAME, 'X-Owner-Id': ownerId,
        'X-Cube-Workspace': WORKSPACE,
      },
      body: JSON.stringify({ session_id: null, owner_id: ownerId, game: GAME, message: q }),
    });
    return { raw: res.ok ? await res.text() : '', httpStatus: res.status, latencyMs: Date.now() - started };
  } catch (err) {
    return { raw: '', httpStatus: (err as Error).name === 'AbortError' ? 408 : 0, latencyMs: Date.now() - started };
  } finally { clearTimeout(timer); }
}

async function runCase(c: EvalCase): Promise<{ result: AqResult; trail: CaseTrail | null }> {
  // A pristine per-case owner so owner-keyed saved-default personalization
  // (user_disambig_prefs) can't contaminate routing: a stray "by platform"
  // dimension default leaks into later cases and makes the agent clarify-and-
  // stop with no artifact. A real new user asking one question has empty prefs;
  // that's exactly what a routing scorecard must measure.
  const ownerId = `aqeval-${c.id}`;
  const { raw, httpStatus, latencyMs } = await fetchTurnRaw(c.question, ownerId);
  const summary = summariseSseText(raw);
  const artifacts = extractEvents(raw, 'query_artifact');

  let resolvedRef: string | null = null;
  let nonEmpty = false;
  let artifactTitle: string | null = null;
  for (const a of artifacts) {
    const query = a['query'] as Record<string, unknown> | undefined;
    const measures = query?.['measures'] as string[] | undefined;
    if (!resolvedRef && measures?.length) resolvedRef = measures[0]!;
    if (!artifactTitle && typeof a['title'] === 'string') artifactTitle = a['title'] as string;
    // non-empty: the artifact's chart carries originalRowCount (rows live on the
    // chart, not the artifact root; the 'result' SSE event is final text only).
    const chart = a['chart'] as Record<string, unknown> | undefined;
    const rc = chart?.['originalRowCount'] as number | undefined;
    if (typeof rc === 'number' && rc > 0) nonEmpty = true;
  }

  // The final 'result' event carries the user-facing answer text + token/cost.
  const resultEv = extractEvents(raw, 'result').at(-1);
  const answerText = typeof resultEv?.['text'] === 'string' ? (resultEv['text'] as string) : null;
  const costUsd = typeof resultEv?.['cost_usd'] === 'number' ? (resultEv['cost_usd'] as number) : null;
  const outputTokens = typeof resultEv?.['output_tokens'] === 'number' ? (resultEv['output_tokens'] as number) : null;

  // The cap / fatal-turn signal arrives as a 'turn-error' event (httpStatus is
  // still 200), which summariseSseText doesn't fold in — capture it here so
  // fail-fast cap detection actually fires.
  const turnErr = extractEvents(raw, 'turn-error').at(-1);
  const turnErrMsg = turnErr
    ? String(turnErr['errorMessage'] ?? turnErr['message'] ?? turnErr['error'] ?? '')
    : null;
  const errorDetail = summary.errorMessage ?? (turnErrMsg || undefined);

  const status: AqResult['status'] = httpStatus !== 200 ? 'http-error'
    : errorDetail || !summary.sawDone ? 'turn-error'
    : summary.artifactCount === 0 ? 'no-artifact' : 'ok';

  // Build the full trail from the raw stream (tool args, reasoning, every event).
  // trailFile is where runOne will persist it; null when capture is off.
  let trail: CaseTrail | null = null;
  let trailFile: string | null = null;
  if (TRAIL_ENABLED && RUN_DIR) {
    const events = parseAllEvents(raw);
    trail = {
      caseId: c.id, question: c.question, curationGroup: c.curationGroup,
      expectedRef: c.expectedRef, httpStatus, latencyMs,
      capturedAt: new Date().toISOString(),
      rawSse: raw, events, toolTrail: buildToolTrail(events),
      thinkingText: reconstructText(events, 'thinking'),
      assistantText: reconstructText(events, 'token'),
    };
    trailFile = relative(__dir, join(RUN_DIR, 'cases', `${c.id}.json`));
  }

  const result: AqResult = {
    caseId: c.id, question: c.question, curationGroup: c.curationGroup,
    expectedRef: c.expectedRef, status, httpStatus, resolvedRef,
    resolvedCube: resolvedRef ? resolvedRef.split('.')[0]! : null,
    artifactCount: summary.artifactCount, nonEmpty, trustGuardSeen: sawTrustGuard(raw),
    errorDetail,
    answerText, artifactTitle, toolCalls: summary.toolCalls, latencyMs, costUsd, outputTokens,
    trailFile,
  };
  return { result, trail };
}

async function main(): Promise<void> {
  const corpusPath = process.env['CORPUS'] ?? join(__dir, `${GAME}-question-bank.json`);
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as EvalCorpus;
  let cases = corpus.cases;
  if (GROUP) cases = cases.filter((c) => c.curationGroup === GROUP);
  if (Number.isFinite(LIMIT)) cases = cases.slice(0, LIMIT);

  // Resume support: the subscription window can't always finish a big batch in
  // one go (it caps), so RESUME=1 reloads a prior snapshot, keeps cases that
  // already answered, and only re-runs the rest — windowed runs converge.
  const outPathEarly = process.env['SNAPSHOT_OUT']
    ? resolve(process.env['SNAPSHOT_OUT']) : join(__dir, `${GAME}-aq-snapshot.json`);
  // priorAll = every result from the prior snapshot (the merge baseline, so a
  // case we filter out of this window survives even if the window aborts before
  // its turn). priorSkip = the subset we won't re-run this window. These roles
  // MUST stay separate: merging from priorSkip alone would silently drop cases
  // that were queued for retry but never reached before a cap/kill.
  let priorAll = new Map<string, AqResult>();
  let priorSkip = new Map<string, AqResult>();
  if (process.env['RESUME'] === '1') {
    // By default resume keeps only 'ok' and re-runs the rest. RESUME_KEEP is a
    // comma-list of extra statuses to preserve — e.g. RESUME_KEEP=no-artifact
    // retries only transport/turn errors and leaves structural gaps untouched
    // (avoids burning quota re-running cases that are known-unanswerable).
    const keepStatuses = new Set(['ok',
      ...(process.env['RESUME_KEEP'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
    try {
      const prev = JSON.parse(readFileSync(outPathEarly, 'utf8')) as { results: AqResult[] };
      for (const r of prev.results) {
        priorAll.set(r.caseId, r);
        if (keepStatuses.has(r.status)) priorSkip.set(r.caseId, r);
      }
      cases = cases.filter((c) => !priorSkip.has(c.id));
      console.log(`[runner] RESUME: ${priorAll.size} prior (${priorSkip.size} kept ${[...keepStatuses].join('+')}), ${cases.length} remaining`);
    } catch { /* no prior snapshot — full run */ }
  }

  console.log(`[runner] ${GAME} | ${cases.length} cases | ${CHAT_BASE} | ws=${WORKSPACE}`);
  await setSubscriptionLane();

  // Warmup: the first turn(s) after a lane switch hit a cold path (agent boot +
  // cold Trino) and can fail spuriously. Burn one throwaway turn so the scored
  // cases run against a warm service — don't let case #1 eat the cold start.
  if (process.env['SKIP_WARMUP'] !== '1' && cases.length > 0) {
    process.stdout.write('[runner] warmup turn… ');
    // Warmup is a throwaway turn — discard its trail so it can't collide with the
    // real case[0] trail file.
    const { result: w } = await runCase({ ...cases[0]!, question: 'dau yesterday' } as EvalCase);
    console.log(w.status === 'ok' ? `ok (${w.latencyMs}ms)` : `(${w.status}, continuing)`);
  }

  // Pace between turns; a sustained back-to-back batch trips the subscription
  // session cap. PACE_MS gives the lane breathing room (default 2s).
  const PACE_MS = process.env['PACE_MS'] ? Number(process.env['PACE_MS']) : 2000;
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
  // Detecting the session/usage cap mid-batch means every remaining turn is
  // doomed — abort fast rather than burn 80 garbage attempts.
  const isCapHit = (r: AqResult) =>
    /session limit|usage limit|rate.?limit/i.test(r.errorDetail ?? '');

  // Bounded concurrency: N turns in flight at once. The bottleneck is the single
  // shared subscription quota (one chat-service, one OAuth token), so concurrency
  // doesn't raise the cap — it spends it faster for less wall-clock. Default 1 =
  // original sequential behaviour; raise (e.g. 4) only with fresh window headroom.
  const CONCURRENCY = process.env['CONCURRENCY'] ? Math.max(1, Number(process.env['CONCURRENCY'])) : 1;
  const results: AqResult[] = [];
  let aborted = false;
  let nextIdx = 0;

  // Checkpoint after every case: a hard kill or a cap-abort must not lose the
  // turns already spent (subscription quota is the scarce resource). RESUME=1
  // then picks up exactly where the last flush left off.
  const flush = (): void => {
    const merged = new Map<string, AqResult>(priorAll);
    for (const r of results) merged.set(r.caseId, r);
    const allMerged = [...merged.values()];
    writeFileSync(outPathEarly, JSON.stringify({
      capturedAt: new Date().toISOString(), gameId: GAME, workspace: WORKSPACE,
      chatBase: CHAT_BASE, corpusVersion: corpus.capturedAt, runDir: RUN_DIR, results: allMerged,
    }, null, 2), 'utf8');
    // Run manifest: a navigable index of this run's trail (one row per case →
    // its trail file + headline outcome), kept in sync with every checkpoint.
    if (RUN_DIR) {
      mkdirSync(RUN_DIR, { recursive: true });
      writeFileSync(join(RUN_DIR, 'manifest.json'), JSON.stringify({
        runStartedAt: RUN_STARTED_ISO, gameId: GAME, group: GROUP || null,
        workspace: WORKSPACE, chatBase: CHAT_BASE, trailEnabled: TRAIL_ENABLED,
        snapshotPath: outPathEarly, caseCount: allMerged.length,
        cases: allMerged.map((r) => ({
          caseId: r.caseId, question: r.question, curationGroup: r.curationGroup,
          status: r.status, expectedRef: r.expectedRef, resolvedRef: r.resolvedRef,
          latencyMs: r.latencyMs, costUsd: r.costUsd, outputTokens: r.outputTokens,
          trailFile: r.trailFile,
        })),
      }, null, 2), 'utf8');
    }
  };

  // Persist a case's full trail as one file under RUN_DIR/cases/.
  const writeTrail = (trail: CaseTrail | null): void => {
    if (!trail || !RUN_DIR) return;
    mkdirSync(join(RUN_DIR, 'cases'), { recursive: true });
    writeFileSync(join(RUN_DIR, 'cases', `${trail.caseId}.json`), JSON.stringify(trail, null, 2), 'utf8');
  };

  async function runOne(c: EvalCase): Promise<void> {
    if (aborted) return;
    let { result: r, trail } = await runCase(c);
    if (r.status === 'http-error' && (r.httpStatus === 408 || r.httpStatus === 0)) {
      await sleep(PACE_MS);
      ({ result: r, trail } = await runCase(c));
    }
    results.push(r);
    writeTrail(trail);
    flush();
    const ok = r.status === 'ok' ? '✓' : '✗';
    const hit = r.expectedRef ? (r.resolvedRef === r.expectedRef ? '=' : '≠') : '·';
    console.log(`  ${ok} [${r.curationGroup}] "${c.question.slice(0, 44)}" ${hit} ${r.resolvedRef ?? '(none)'}${r.nonEmpty ? ' rows' : ''}`);
    if (isCapHit(r)) {
      aborted = true;
      console.error(`\n[runner] ABORT — auth lane cap hit: "${r.errorDetail}". ` +
        `Done ${results.length}/${cases.length}. Resume after the cap resets.`);
    }
  }

  async function worker(slot: number): Promise<void> {
    // Stagger worker starts so N cold turns don't all hit the lane at t=0.
    await sleep(slot * PACE_MS);
    while (!aborted) {
      const i = nextIdx++;
      if (i >= cases.length) return;
      await runOne(cases[i]!);
      // In sequential mode keep the original inter-turn pacing; under real
      // concurrency the in-flight depth already paces the lane.
      if (CONCURRENCY === 1 && !aborted) await sleep(PACE_MS);
    }
  }

  console.log(`[runner] concurrency=${CONCURRENCY}`);
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cases.length) }, (_, s) => worker(s)),
  );

  // Merge prior snapshot with this run's results (this run wins on caseId).
  const merged = new Map<string, AqResult>(priorAll);
  for (const r of results) merged.set(r.caseId, r);
  const allResults = [...merged.values()];

  const snapshot = {
    capturedAt: new Date().toISOString(), gameId: GAME, workspace: WORKSPACE,
    chatBase: CHAT_BASE, corpusVersion: corpus.capturedAt, runDir: RUN_DIR, results: allResults,
  };
  writeFileSync(outPathEarly, JSON.stringify(snapshot, null, 2), 'utf8');
  // Freeze a copy of the lean snapshot inside the run dir so each run dir is a
  // self-contained point-in-time record (longitudinal trail across runs).
  if (RUN_DIR) {
    mkdirSync(RUN_DIR, { recursive: true });
    writeFileSync(join(RUN_DIR, 'snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  }
  const out = outPathEarly;

  const okN = allResults.filter((r) => r.status === 'ok').length;
  const resolved = allResults.filter((r) => r.expectedRef && r.resolvedRef === r.expectedRef).length;
  const withGolden = allResults.filter((r) => r.expectedRef).length;
  console.log(`\n[runner] answered ${okN}/${results.length} · resolution ${resolved}/${withGolden} golden · → ${out}`);
  if (RUN_DIR) console.log(`[runner] full trail → ${RUN_DIR}/ (cases/, manifest.json, snapshot.json)`);
}

main().catch((e) => { console.error('[runner] fatal:', e); process.exit(1); });
