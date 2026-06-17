/**
 * Agent-intelligence eval runner (P6, live + manual).
 *
 * Drives the fixed corpus (test/agent-intelligence-eval/corpus.json) against a
 * running chat-service and tallies the metrics that map 1:1 to the plan's
 * success criteria: did the turn ask a clarification, did it produce an answer
 * (query_artifact), and how many turns it took. Run it twice — flags off
 * (baseline) then flags on (treatment) — and diff the JSON.
 *
 * The deterministic sub-checks (grain gate, smart-default table, resolved-
 * context rendering) are covered by vitest and gate CI without an LLM; this
 * runner covers the guidance-dependent behaviour that only a live model shows.
 * LLM nondeterminism is real, so run N≥3 and read the median, not a single shot.
 *
 * Usage:
 *   # baseline — all flags off (default)
 *   EVAL_BASE_URL=http://localhost:3005 npx tsx src/scripts/run-agent-intelligence-eval.ts > baseline.json
 *   # treatment — start the service with the flags on, then:
 *   AGENT_MODEL_DIGEST_ENABLED=true AGENT_RESOLVED_CONTEXT_ENABLED=true \
 *     AGENT_SMART_DEFAULTS_ENABLED=true AGENT_MODE_GOVERNS_POSTURE=true \
 *     AGENT_ENGINE_ROUTING=true npx tsx src/index.ts            # in one shell
 *   EVAL_BASE_URL=http://localhost:3005 npx tsx src/scripts/run-agent-intelligence-eval.ts > treatment.json
 *
 * Env: EVAL_BASE_URL, EVAL_OWNER (default "dev"), EVAL_MODE (targeted|aggressive).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = resolve(__dirname, '../../test/agent-intelligence-eval/corpus.json');

const BASE_URL = process.env['EVAL_BASE_URL'] ?? 'http://localhost:3005';
const OWNER = process.env['EVAL_OWNER'] ?? 'dev';
const MODE = process.env['EVAL_MODE'] ?? undefined;
const TOKEN = process.env['EVAL_CUBE_TOKEN'] ?? 'dev'; // cube /meta is unauthenticated in dev
const WORKSPACE = process.env['EVAL_WORKSPACE'] ?? 'local';

interface CorpusPrompt {
  id: string;
  category: string;
  prompt: string;
  priorContext?: string;
}
interface Corpus {
  game: string;
  prompts: CorpusPrompt[];
}

interface PromptResult {
  id: string;
  category: string;
  status: 'done' | 'error' | 'aborted' | 'no-end';
  askedClarification: boolean;
  producedArtifact: boolean;
  ms: number;
  sessionId: string | null;
}

function frameValue(frame: string, prefix: string): string | undefined {
  const line = frame.split('\n').find((l) => l.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

/** POST one turn (optionally threading a session) and drain its SSE stream. */
async function runTurn(
  game: string,
  message: string,
  sessionId: string | null,
): Promise<PromptResult & { id: string; category: string }> {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/agent/turn`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cube-Token': TOKEN,
      'X-Cube-Game': game,
      'X-Cube-Workspace': WORKSPACE,
      'X-Owner-Id': OWNER,
    },
    body: JSON.stringify({ owner_id: OWNER, game, message, session_id: sessionId, mode: MODE }),
  });

  const base = { id: '', category: '', status: 'error' as const, askedClarification: false, producedArtifact: false, ms: 0, sessionId };
  if (!res.ok || !res.body) {
    return { ...base, ms: Date.now() - started };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let status: PromptResult['status'] = 'no-end';
  let askedClarification = false;
  let producedArtifact = false;
  let nextSession = sessionId;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const name = frameValue(frame, 'event:') ?? 'message';
      if (name === 'disambig_options') askedClarification = true;
      else if (name === 'query_artifact') producedArtifact = true;
      else if (name === 'done') status = 'done';
      else if (name === 'turn_aborted') status = 'aborted';
      else if (name === 'error') status = 'error';
      else if (name === 'session_created') {
        // The session_created frame payload is `{ id: <sessionId> }`.
        const data = frameValue(frame, 'data:');
        if (data) {
          try {
            nextSession = (JSON.parse(data) as { id?: string }).id ?? nextSession;
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  return { id: '', category: '', status, askedClarification, producedArtifact, ms: Date.now() - started, sessionId: nextSession };
}

async function main(): Promise<void> {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
  const results: PromptResult[] = [];
  // Thread a single session so follow-up / rephrase prompts see prior memory.
  let sessionId: string | null = null;

  for (const p of corpus.prompts) {
    process.stderr.write(`[${p.id}] ${p.prompt.slice(0, 48)} ... `);
    try {
      const r = await runTurn(corpus.game, p.prompt, sessionId);
      sessionId = r.sessionId;
      results.push({ ...r, id: p.id, category: p.category });
      process.stderr.write(`${r.status} clarify=${r.askedClarification} artifact=${r.producedArtifact} (${r.ms}ms)\n`);
    } catch (err) {
      results.push({ id: p.id, category: p.category, status: 'error', askedClarification: false, producedArtifact: false, ms: 0, sessionId });
      process.stderr.write(`THREW :: ${(err as Error).message}\n`);
    }
  }

  const clarifyCount = results.filter((r) => r.askedClarification).length;
  const answeredCount = results.filter((r) => r.producedArtifact).length;
  const summary = {
    baseUrl: BASE_URL,
    mode: MODE ?? 'default',
    total: results.length,
    clarifyingTurns: clarifyCount,
    answered: answeredCount,
    results,
  };
  // JSON to stdout (machine-diffable); progress to stderr.
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`eval runner failed: ${(err as Error).message}\n`);
  process.exit(1);
});
