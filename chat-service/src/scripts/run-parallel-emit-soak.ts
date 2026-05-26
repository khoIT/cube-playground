/**
 * Parallel-emit soak harness — fires N real questions at a running chat-service
 * instance (started with OBS_PARALLEL_EMIT=true), waits for each turn to drain,
 * then reads runtime/parallel-emit/diffs.jsonl and prints a cutover-decision
 * summary.
 *
 * Usage:
 *   OBS_PARALLEL_EMIT=true PORT=3006 npx tsx src/index.ts        # in one shell
 *   SOAK_BASE_URL=http://localhost:3006 npx tsx src/scripts/run-parallel-emit-soak.ts
 *
 * Env:
 *   SOAK_BASE_URL   target service base (default http://localhost:3006)
 *   SOAK_OWNER      owner_id + X-Owner-Id   (default "dev")
 *   SOAK_GAME       game + X-Cube-Game       (default "ballistar")
 *   SOAK_TOKEN      X-Cube-Token             (default "dev" — cube /meta is unauthenticated in dev)
 *
 * The harness only needs the turn to *flow messages through both observability
 * paths*; whether a tool call succeeds is irrelevant to the diff (identical
 * message shapes either way).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIFF_LOG = resolve(__dirname, '../../runtime/parallel-emit/diffs.jsonl');

const BASE_URL = process.env['SOAK_BASE_URL'] ?? 'http://localhost:3006';
const OWNER = process.env['SOAK_OWNER'] ?? 'dev';
const GAME = process.env['SOAK_GAME'] ?? 'ballistar';
const TOKEN = process.env['SOAK_TOKEN'] ?? 'dev';

// 10 questions spanning no-tool answers, single tool calls, multi-step
// comparisons, and follow-ups — to exercise sdk_event / llm_call /
// tool_invocation / turn_finalized dispatch across realistic shapes.
const QUESTIONS = [
  'What metrics can I explore for this game?',
  'show revenue last 7 days',
  'ARPU vs paying-rate per country',
  'Compare iOS vs Android revenue week over week in the last 3 months',
  'Top 10 countries by revenue last 30 days',
  'How many daily active users did we have yesterday?',
  'Plot retention by install cohort for the last 8 weeks',
  'What was the conversion rate from install to first purchase last month?',
  'Break down revenue by platform and country for last quarter',
  'Show me a funnel from session start to purchase',
];

interface TurnOutcome {
  index: number;
  question: string;
  status: 'done' | 'error' | 'aborted' | 'no-end';
  httpStatus: number;
  eventCounts: Record<string, number>;
  ms: number;
  errorDetail?: string;
}

/** POST one turn and drain its SSE stream to completion. */
async function runTurn(index: number, question: string): Promise<TurnOutcome> {
  const started = Date.now();
  const eventCounts: Record<string, number> = {};
  const res = await fetch(`${BASE_URL}/agent/turn`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cube-Token': TOKEN,
      'X-Cube-Game': GAME,
      'X-Owner-Id': OWNER,
    },
    body: JSON.stringify({ owner_id: OWNER, game: GAME, message: question, session_id: null }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    return {
      index,
      question,
      status: 'error',
      httpStatus: res.status,
      eventCounts,
      ms: Date.now() - started,
      errorDetail: text.slice(0, 200),
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalStatus: TurnOutcome['status'] = 'no-end';
  let errorDetail: string | undefined;

  // Parse text/event-stream framed as `event: <name>\ndata: <json>\n\n`.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const evLine = frame.split('\n').find((l) => l.startsWith('event:'));
      const name = evLine ? evLine.slice('event:'.length).trim() : 'message';
      eventCounts[name] = (eventCounts[name] ?? 0) + 1;
      if (name === 'done') finalStatus = 'done';
      else if (name === 'turn_aborted') finalStatus = 'aborted';
      else if (name === 'error') {
        finalStatus = 'error';
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        errorDetail = dataLine?.slice('data:'.length).trim().slice(0, 200);
      }
    }
  }

  return {
    index,
    question,
    status: finalStatus,
    httpStatus: res.status,
    eventCounts,
    ms: Date.now() - started,
    errorDetail,
  };
}

function readDiffRecords(): Record<string, unknown>[] {
  if (!existsSync(DIFF_LOG)) return [];
  return readFileSync(DIFF_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function main(): Promise<void> {
  console.log(`\n=== Parallel-emit soak → ${BASE_URL}  (owner=${OWNER} game=${GAME}) ===\n`);

  // Snapshot the diff log size before the run so we only summarize this batch.
  const before = readDiffRecords().length;

  const outcomes: TurnOutcome[] = [];
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    process.stdout.write(`[${i + 1}/${QUESTIONS.length}] ${QUESTIONS[i].slice(0, 50)} ... `);
    try {
      const outcome = await runTurn(i + 1, QUESTIONS[i]);
      outcomes.push(outcome);
      console.log(`${outcome.status} (${outcome.ms}ms, http ${outcome.httpStatus})${outcome.errorDetail ? ` :: ${outcome.errorDetail}` : ''}`);
    } catch (err) {
      console.log(`THREW :: ${(err as Error).message}`);
      outcomes.push({ index: i + 1, question: QUESTIONS[i], status: 'error', httpStatus: 0, eventCounts: {}, ms: 0, errorDetail: (err as Error).message });
    }
  }

  // Give the post-turn diff append a moment to flush to disk.
  await new Promise((r) => setTimeout(r, 500));

  const all = readDiffRecords();
  const batch = all.slice(before);

  console.log(`\n=== Diff records this batch: ${batch.length} (log total ${all.length}) ===\n`);
  let matches = 0;
  let mismatches = 0;
  let maxLatency = 0;
  const aggregateKinds: Record<string, number> = {};

  for (const rec of batch) {
    const match = rec['match'] === true;
    if (match) matches += 1;
    else mismatches += 1;
    maxLatency = Math.max(maxLatency, Number(rec['maxLatencyDeltaMs'] ?? 0));
    const kinds = (rec['kindCounts'] ?? {}) as Record<string, number>;
    for (const [k, v] of Object.entries(kinds)) aggregateKinds[k] = (aggregateKinds[k] ?? 0) + v;
    const flag = match ? 'MATCH' : `MISMATCH x${rec['mismatchCount']}`;
    console.log(
      `  ${flag.padEnd(14)} legacy=${rec['legacyCount']} shadow=${rec['shadowCount']} ` +
        `Δlatency=${rec['maxLatencyDeltaMs']}ms  "${String(rec['message']).slice(0, 40)}"`,
    );
    if (!match) {
      console.log(`     mismatches: ${JSON.stringify(rec['mismatchSample'])}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Turns fired:        ${outcomes.length}`);
  console.log(`  Turns completed ok: ${outcomes.filter((o) => o.status === 'done').length}`);
  console.log(`  Diff records:       ${batch.length}`);
  console.log(`  Byte-identical:     ${matches}`);
  console.log(`  Diverged:           ${mismatches}`);
  console.log(`  Max latency delta:  ${maxLatency}ms (informational — independent clocks)`);
  console.log(`  Events compared:    ${JSON.stringify(aggregateKinds)}`);
  console.log(
    `\n  Verdict: ${mismatches === 0 && batch.length > 0 ? 'SAFE TO CUT OVER — zero structural divergence' : mismatches > 0 ? 'DO NOT CUT OVER — divergence found (see above)' : 'INCONCLUSIVE — no diff records captured (is OBS_PARALLEL_EMIT=true?)'}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
