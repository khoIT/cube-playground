/**
 * CLI: `npm run starters:pregenerate [-- --games a,b --workspace local]`
 *
 * Generate → VERIFY → freeze workflow for per-game starter questions.
 * Every question that ships in seed/starter-questions-seed.json is proven
 * workable end-to-end before it is frozen — no hand-fixing dead chips later.
 *
 * Per game:
 *   1. template baseline + time-coverage probes (data freshness per cube)
 *   2. LLM generates CANDIDATES_PER_TOPIC candidates per topic
 *      (liveops / user_acquisition / monetization), strongest-first
 *   3. tier-1 gate: compose the clicked-chip pass-through query and execute
 *      it — drop candidates whose query errors or returns no rows
 *   4. tier-2 gate: write a PROVISIONAL seed, hot-reload the running
 *      chat-service's seed cache, then drive a REAL chat turn per candidate;
 *      keep the first QUESTIONS_PER_TOPIC per topic that produce a query
 *      artifact and finish cleanly (sessions are kept for transcript review)
 *   5. shortfall → one retry round with failure feedback in the prompt
 *   6. freeze the verified set (+ coverage, verifiedAt) into the seed file,
 *      merging with other games' existing entries, and reload once more
 *
 * Requires the chat-service dev server running (tier 2 talks to it over HTTP)
 * and the playground server for meta/queries.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { config } from '../config.js';
import { getMeta, extractMemberNames } from '../core/cube-meta-cache.js';
import { buildTemplateQuestions } from '../core/starter-question-templates.js';
import {
  buildMetaProjection,
  buildRefinePrompt,
  parseAndValidateLlmSet,
  defaultCallLlm,
  SEED_TOPICS,
  QUESTIONS_PER_TOPIC,
} from '../core/starter-question-refiner.js';
import { handler as timeCoverageHandler } from '../tools/get-time-coverage.js';
import {
  cheapVerify,
  verifyViaChatTurn,
} from './verify-starter-question-workability.js';
import { fetchOfficialGlossary } from '../nl-to-query/glossary-client.js';
import { openDatabase } from '../db/migrate.js';
import { upsertSet, type StarterQuestion } from '../db/starter-questions-store.js';
import {
  STARTER_SEED_PATH,
  type StarterSeedFile,
  type StarterSeedEntry,
} from '../db/starter-questions-seed.js';
import type { ToolContext } from '../types.js';

const MIN_TEMPLATE_QUESTIONS = 3;
/** Coverage probes are real Cube queries — bound the per-game cost. */
const MAX_COVERAGE_PROBES = 12;
/** LLM generation rounds per game (initial + retries with failure feedback). */
const MAX_GENERATION_ROUNDS = 2;
const VERIFY_OWNER_ID = 'starter-question-verifier';

type Topic = (typeof SEED_TOPICS)[number];

interface CliArgs {
  workspace: string;
  games: string[] | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { workspace: 'local', games: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace' && argv[i + 1]) out.workspace = argv[++i];
    if (argv[i] === '--games' && argv[i + 1]) out.games = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

/** Enumerate ready games from the playground server's readiness endpoint. */
async function listReadyGames(workspace: string): Promise<string[]> {
  const url = `${config.serverBaseUrl}/api/workspaces/${encodeURIComponent(workspace)}/games-readiness`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`games-readiness failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { games?: Array<{ id: string; status: string }> };
  return (body.games ?? []).filter((g) => g.status === 'ok').map((g) => g.id);
}

/** First time dimension per cube, from /meta. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function timeDimensionOf(meta: any, cubeName: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cube = (meta?.cubes ?? []).find((c: any) => c.name === cubeName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const td = (cube?.dimensions ?? []).find((d: any) => d.type === 'time');
  return td?.name ?? null;
}

/**
 * Probe the latest date with data for each cube the given questions
 * reference. `known` short-circuits dims probed in an earlier pass.
 */
async function probeCoverage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
  questions: StarterQuestion[],
  ctx: ToolContext,
  known: Record<string, string> = {},
): Promise<Record<string, string>> {
  const cubes = new Set<string>();
  for (const q of questions) {
    for (const ref of q.targetCatalogIds) {
      const cube = ref.includes('.') ? ref.split('.')[0] : null;
      if (cube) cubes.add(cube);
    }
  }
  const coverage: Record<string, string> = { ...known };
  for (const cube of [...cubes].slice(0, MAX_COVERAGE_PROBES)) {
    const timeDim = timeDimensionOf(meta, cube);
    if (!timeDim || coverage[timeDim]) continue;
    try {
      const out = (await timeCoverageHandler({ member: timeDim }, ctx)) as {
        found: boolean; latestDate?: string;
      };
      if (out.found && out.latestDate) coverage[timeDim] = out.latestDate;
    } catch (err) {
      console.warn(`  coverage probe failed for ${timeDim}: ${(err as Error).message}`);
    }
  }
  return coverage;
}

/** Refine prompt + the data-coverage contract + retry feedback appended. */
function buildGenerationPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
  baseline: StarterQuestion[],
  coverage: Record<string, string>,
  todayIso: string,
  failureFeedback: string[],
): string {
  const lines = [
    buildRefinePrompt(buildMetaProjection(meta), baseline),
    '',
    `today: ${todayIso}`,
    'data_coverage (latest date that HAS data, per time dimension — pipelines lag behind today):',
    JSON.stringify(coverage),
    '',
    'COVERAGE RULES:',
    '- Every question must be answerable within data_coverage.',
    '- Adjust each question\'s time range to the data that actually exists: when a cube\'s latest',
    '  date is >14 days before today, do NOT phrase questions as "today", "this week" or',
    '  "this month" for that cube — use period-neutral phrasing like "in the most recent month',
    '  of data" or "over the last 30 days of available data".',
    '- Cubes absent from data_coverage have unknown freshness: prefer period-neutral phrasing.',
    '- All else equal, prefer questions on the cubes with the FRESHEST coverage.',
  ];
  if (failureFeedback.length > 0) {
    lines.push(
      '',
      'PREVIOUS ATTEMPT FEEDBACK — these candidates FAILED live verification.',
      'Do NOT repeat them or near-duplicates; learn from the failure reasons:',
      ...failureFeedback.map((f) => `- ${f}`),
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Seed file helpers — merge-aware so `--games x` never drops other games
// ---------------------------------------------------------------------------

function readSeedFile(): StarterSeedFile | null {
  try {
    if (!existsSync(STARTER_SEED_PATH)) return null;
    return JSON.parse(readFileSync(STARTER_SEED_PATH, 'utf8')) as StarterSeedFile;
  } catch {
    return null;
  }
}

function writeSeedFile(seed: StarterSeedFile): void {
  writeFileSync(STARTER_SEED_PATH, JSON.stringify(seed, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Verification progress sidecar — chat turns are expensive (~40-200s each),
// so verified questions survive an aborted run (gateway 403, ctrl-C) and a
// rerun resumes instead of re-verifying from scratch. Cleared per game on a
// successful freeze. Gitignored: progress is local workflow state, not seed.
// ---------------------------------------------------------------------------

const PROGRESS_PATH = STARTER_SEED_PATH.replace(
  /starter-questions-seed\.json$/,
  'starter-verify-progress.json',
);

interface VerifiedFacts {
  rowCount?: number;
  ms?: number;
  artifactCount?: number;
  sessionId?: string | null;
  query?: unknown;
}

type ProgressFile = Record<string, {
  verified: StarterQuestion[];
  coverage: Record<string, string>;
  /** Per-question gate facts (keyed by question id) — feed the review report. */
  facts?: Record<string, VerifiedFacts>;
}>;

function readProgress(): ProgressFile {
  try {
    if (!existsSync(PROGRESS_PATH)) return {};
    return JSON.parse(readFileSync(PROGRESS_PATH, 'utf8')) as ProgressFile;
  } catch {
    return {};
  }
}

function writeProgress(progress: ProgressFile): void {
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Verification report — reviewed in the FE at /dev/chat-audit/starters via
// GET /debug/starter-verification-report. One entry per candidate (kept AND
// failed) so the question set can be audited without re-asking anything.
// Merged per game like the seed; gitignored (local workflow artifact).
// ---------------------------------------------------------------------------

const REPORT_PATH = STARTER_SEED_PATH.replace(
  /starter-questions-seed\.json$/,
  'starter-verification-report.json',
);

interface ReportGate {
  ok: boolean;
  reason?: string;
  detail?: string;
  rowCount?: number;
  ms?: number;
  artifactCount?: number;
  sessionId?: string | null;
}

interface ReportEntry {
  questionId: string;
  text: string;
  topic: string;
  kept: boolean;
  tier1: ReportGate;
  tier2?: ReportGate;
  query?: unknown;
}

function writeReportForGame(
  gameId: string,
  entries: ReportEntry[],
  meta: { version: string; workspace: string },
): void {
  let report: { version: string; generatedAt: number; workspace: string; games: Record<string, { entries: ReportEntry[] }> };
  try {
    report = existsSync(REPORT_PATH)
      ? JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
      : { version: meta.version, generatedAt: Date.now(), workspace: meta.workspace, games: {} };
  } catch {
    report = { version: meta.version, generatedAt: Date.now(), workspace: meta.workspace, games: {} };
  }
  report.version = meta.version;
  report.generatedAt = Date.now();
  report.workspace = meta.workspace;
  report.games[gameId] = { entries };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

/** Ask the running chat-service to re-read the seed file from disk. */
async function reloadServiceSeed(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/debug/reload-starter-seed`, { method: 'POST' });
  if (!res.ok) throw new Error(`seed reload failed: HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// Per-game pipeline
// ---------------------------------------------------------------------------

const normalise = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
const homeTopic = (q: StarterQuestion): Topic => (q.topicTags[0] ?? 'liveops') as Topic;

interface GameResult {
  entry: StarterSeedEntry;
  turnsRun: number;
}

async function generateVerifiedGameEntry(
  gameId: string,
  workspace: string,
  chatBaseUrl: string,
  seedFileForProvisional: StarterSeedFile,
  version: string,
): Promise<GameResult | null> {
  const ctx = { gameId, workspace } as ToolContext;
  const meta = await getMeta(gameId, workspace);
  const knownMembers = extractMemberNames(meta);

  const baseline = buildTemplateQuestions(meta);
  if (baseline.length < MIN_TEMPLATE_QUESTIONS) {
    console.log(`  skipped — schema too sparse (${baseline.length} template questions)`);
    return null;
  }

  let coverage = await probeCoverage(meta, baseline, ctx);

  const todayIso = new Date().toISOString().slice(0, 10);
  const verified = new Map<Topic, StarterQuestion[]>(SEED_TOPICS.map((t) => [t, []]));
  const failureFeedback: string[] = [];
  const seenTexts = new Set<string>();
  let turnsRun = 0;

  // Resume verified questions from an aborted previous run — each one cost a
  // real chat turn; never pay for it twice.
  const progress = readProgress();
  const facts: Record<string, VerifiedFacts> = {};
  const failedEntries: ReportEntry[] = [];
  const prior = progress[gameId];
  if (prior?.verified?.length) {
    coverage = { ...prior.coverage, ...coverage };
    Object.assign(facts, prior.facts ?? {});
    for (const q of prior.verified) {
      const t = homeTopic(q);
      if (verified.get(t)!.length < QUESTIONS_PER_TOPIC) {
        verified.get(t)!.push(q);
        seenTexts.add(normalise(q.text));
      }
    }
    console.log(`  resumed ${prior.verified.length} verified questions from previous run`);
  }
  const saveProgress = () => {
    progress[gameId] = { verified: [...verified.values()].flat(), coverage, facts };
    writeProgress(progress);
  };
  console.log(`  coverage: ${JSON.stringify(coverage)}`);

  const topicsShort = () =>
    SEED_TOPICS.filter((t) => (verified.get(t)?.length ?? 0) < QUESTIONS_PER_TOPIC);

  for (let round = 0; round < MAX_GENERATION_ROUNDS && topicsShort().length > 0; round++) {
    console.log(`  — generation round ${round + 1} (topics short: ${topicsShort().join(', ')})`);
    const prompt = buildGenerationPrompt(meta, baseline, coverage, todayIso, failureFeedback);
    const raw = await defaultCallLlm(prompt);
    const parsed = parseAndValidateLlmSet(raw, knownMembers);
    if (!parsed) {
      console.error('  LLM set failed member validation — retrying counts as a round');
      failureFeedback.push('entire previous set rejected: invented member names or malformed JSON');
      continue;
    }

    // Fresh candidates only, grouped by home topic, LLM order preserved.
    const candidates = parsed.filter((q) => !seenTexts.has(normalise(q.text)));
    candidates.forEach((q) => seenTexts.add(normalise(q.text)));
    coverage = await probeCoverage(meta, candidates, ctx, coverage);

    // ---- tier 1: pass-through query composes AND returns rows ----
    const cheapPassed: StarterQuestion[] = [];
    for (const q of candidates) {
      if (!topicsShort().includes(homeTopic(q))) continue; // topic already full
      const res = await cheapVerify(q, meta, knownMembers, coverage, ctx);
      if (res.ok) {
        cheapPassed.push(q);
        facts[q.id] = { ...facts[q.id], rowCount: res.rowCount, query: res.query };
      } else {
        console.log(`    ✗ [tier1 ${res.reason}] ${q.text.slice(0, 70)}`);
        failureFeedback.push(`"${q.text}" — query ${res.reason}${res.detail ? ` (${res.detail.slice(0, 80)})` : ''}`);
        failedEntries.push({
          questionId: q.id, text: q.text, topic: homeTopic(q), kept: false,
          tier1: { ok: false, reason: res.reason, detail: res.detail, rowCount: res.rowCount },
          query: res.query,
        });
      }
    }
    console.log(`    tier1: ${cheapPassed.length}/${candidates.length} candidates passed`);

    // ---- tier 2: real chat turn via the running service ----
    // The pass-through only fires for questions in the LOADED seed, so write
    // a provisional entry (verified + remaining candidates) and hot-reload.
    const provisionalQuestions = [...[...verified.values()].flat(), ...cheapPassed];
    seedFileForProvisional.games[gameId] = { questions: provisionalQuestions, coverage };
    seedFileForProvisional.version = `${version}-provisional`;
    writeSeedFile(seedFileForProvisional);
    await reloadServiceSeed(chatBaseUrl);

    for (const q of cheapPassed) {
      const topic = homeTopic(q);
      if (!topicsShort().includes(topic)) continue;
      process.stdout.write(`    turn-verify [${topic}] ${q.text.slice(0, 60)}… `);
      const res = await verifyViaChatTurn(q.text, {
        baseUrl: chatBaseUrl, game: gameId, workspace, ownerId: VERIFY_OWNER_ID,
      });
      turnsRun++;
      // Sessions are KEPT (under the verifier owner, invisible in normal
      // sidebars) so the report can link to the full transcript for review.
      if (res.ok) {
        verified.get(topic)!.push(q);
        facts[q.id] = { ...facts[q.id], ms: res.ms, artifactCount: res.artifactCount, sessionId: res.sessionId };
        saveProgress();
        console.log(`✓ (${res.artifactCount} artifact, ${Math.round(res.ms / 1000)}s)`);
      } else if (res.infrastructure) {
        // Gateway 403/429 or dead service — NOT the question's fault. Abort
        // instead of burning every remaining candidate on a broken backend;
        // verified progress is saved, so the rerun resumes here.
        console.log(`✗ INFRASTRUCTURE: ${res.detail}`);
        throw new Error(
          `infrastructure failure during verification (${res.detail}) — fix the environment and rerun; ` +
          `${[...verified.values()].flat().length} verified questions are saved in ${PROGRESS_PATH}`,
        );
      } else {
        console.log(`✗ ${res.reason} (${Math.round(res.ms / 1000)}s)`);
        failureFeedback.push(`"${q.text}" — chat turn ${res.reason}${res.detail ? ` (${res.detail.slice(0, 80)})` : ''}`);
        failedEntries.push({
          questionId: q.id, text: q.text, topic: homeTopic(q), kept: false,
          tier1: { ok: true, rowCount: facts[q.id]?.rowCount },
          tier2: { ok: false, reason: res.reason, detail: res.detail, ms: res.ms, artifactCount: res.artifactCount, sessionId: res.sessionId },
          query: facts[q.id]?.query,
        });
      }
    }
  }

  const short = topicsShort();
  if (short.length > 0) {
    const counts = SEED_TOPICS.map((t) => `${t}=${verified.get(t)!.length}`).join(' ');
    throw new Error(
      `verification could not fill ${QUESTIONS_PER_TOPIC}/topic after ${MAX_GENERATION_ROUNDS} rounds (${counts}) — rerun or relax`,
    );
  }

  const questions = SEED_TOPICS.flatMap((t) => verified.get(t)!.slice(0, QUESTIONS_PER_TOPIC));
  // Review report: every kept question (with its gate facts) + this run's failures.
  const keptEntries: ReportEntry[] = questions.map((q) => ({
    questionId: q.id, text: q.text, topic: homeTopic(q), kept: true,
    tier1: { ok: true, rowCount: facts[q.id]?.rowCount },
    tier2: {
      ok: true,
      ms: facts[q.id]?.ms,
      artifactCount: facts[q.id]?.artifactCount,
      sessionId: facts[q.id]?.sessionId ?? null,
    },
    query: facts[q.id]?.query,
  }));
  writeReportForGame(gameId, [...keptEntries, ...failedEntries], { version, workspace });
  // Frozen successfully — drop the resume state for this game.
  delete progress[gameId];
  writeProgress(progress);
  return { entry: { questions, coverage, verifiedAt: Date.now() }, turnsRun };
}

/** Warn-only: how many target members per question resolve in the official glossary/metrics catalog. */
async function reportGlossaryCrossCheck(questions: StarterQuestion[]): Promise<void> {
  try {
    const terms = await fetchOfficialGlossary();
    const catalogRefs = new Set<string>();
    for (const t of terms) {
      if (t.measureRef) catalogRefs.add(t.measureRef);
      if (t.ratioRef) { catalogRefs.add(t.ratioRef.numerator); catalogRefs.add(t.ratioRef.denominator); }
      if (t.defaultMeasureRef) catalogRefs.add(t.defaultMeasureRef);
    }
    for (const q of questions) {
      const linked = q.targetCatalogIds.filter((r) => catalogRefs.has(r));
      if (linked.length > 0) console.log(`    glossary-linked ${linked.length}/${q.targetCatalogIds.length}: ${q.id}`);
    }
  } catch (err) {
    console.warn(`  glossary cross-check skipped: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const chatBaseUrl = `http://localhost:${config.port}`;

  // Tier 2 needs the live service — fail fast with a clear message.
  const health = await fetch(`${chatBaseUrl}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`chat-service not reachable at ${chatBaseUrl} — start it (npm run dev) before pregenerating`);
  }

  const games = args.games ?? (await listReadyGames(args.workspace));
  if (games.length === 0) throw new Error('no games to generate for');

  const now = Date.now();
  const todayIso = new Date(now).toISOString().slice(0, 10);
  // Version doubles as the served meta_hash — date-stamped for traceability.
  const version = todayIso.replace(/-/g, '').slice(2) + '-' + String(now % 10000).padStart(4, '0');

  console.log(`Pregenerating starter questions: workspace=${args.workspace} games=${games.join(',')} version=${version}`);
  console.log(`Target: ${QUESTIONS_PER_TOPIC} verified questions per topic (${SEED_TOPICS.join(' / ')})`);

  // Merge into the existing seed so a partial --games run keeps other games.
  // Snapshot the pre-run state FIRST: tier-2 writes provisional entries to
  // disk mid-run, so a late readSeedFile() would see mutated data.
  const originalSeed = readSeedFile();
  const seed: StarterSeedFile = structuredClone(originalSeed) ?? {
    version, generatedAt: now, workspaceGenerated: args.workspace, games: {},
  };

  const succeeded: string[] = [];
  for (const gameId of games) {
    console.log(`\n[${gameId}]`);
    try {
      const result = await generateVerifiedGameEntry(gameId, args.workspace, chatBaseUrl, seed, version);
      if (!result) continue;
      seed.games[gameId] = result.entry;
      succeeded.push(gameId);
      console.log(`  ✓ ${result.entry.questions.length} verified questions (${result.turnsRun} chat turns)`);
      await reportGlossaryCrossCheck(result.entry.questions);
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message} — game left with its previous seed entry`);
      // Restore the pre-run entry over any provisional remnant (the on-disk
      // file was mutated mid-run; only the startup snapshot is trustworthy).
      if (originalSeed?.games[gameId]) seed.games[gameId] = originalSeed.games[gameId];
      else delete seed.games[gameId];
    }
  }

  if (succeeded.length === 0) {
    // Tier 2 wrote provisional entries to disk mid-run — put the pre-run
    // seed back so the running service never keeps serving candidates.
    if (originalSeed) {
      writeSeedFile(originalSeed);
      await reloadServiceSeed(chatBaseUrl);
    }
    throw new Error('no game produced a verified set — seed restored to pre-run state');
  }

  seed.version = version;
  seed.generatedAt = now;
  seed.workspaceGenerated = args.workspace;
  writeSeedFile(seed);
  await reloadServiceSeed(chatBaseUrl);
  console.log(`\nSeed written: ${STARTER_SEED_PATH} (updated: ${succeeded.join(', ')})`);

  // Mirror into the local DB so this environment serves the seed immediately.
  const db = openDatabase(config.chatDbPath);
  for (const [gameId, entry] of Object.entries(seed.games)) {
    upsertSet(db, {
      workspace: args.workspace, gameId, metaHash: `seed:${version}`,
      source: 'seed', questions: entry.questions, status: 'seed',
    });
  }
  db.close();
  console.log('DB rows upserted (source=seed).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
