/**
 * CLI: `npm run knowledge:pregenerate [-- --games a,b --workspace local]`
 *
 * Builds seed/game-topic-knowledge-seed.json — the per-game knowledge bank:
 * per topic, up to KNOWLEDGE_QUESTIONS_PER_TOPIC verified questions (the
 * shipped starter chips first, then LLM extras that pass the tier-1 gate:
 * pass-through query composes AND returns rows) plus the common metrics the
 * game's data model serves (member-validated against /meta measures).
 *
 * No tier-2 chat turns here — the bank grounds suggestions and orientation
 * answers (get_topic_knowledge tool), it is not a clickable chip surface.
 * Requires the playground server (meta + queries); chat-service NOT needed.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { getMeta, extractMemberNames } from '../core/cube-meta-cache.js';
import {
  parseAndValidateLlmSet,
  defaultCallLlm,
  buildMetaProjection,
  SEED_TOPICS,
  questionDepth,
} from '../core/starter-question-refiner.js';
import {
  buildKnowledgePrompt,
  parseKnowledgeSet,
  KNOWLEDGE_QUESTIONS_PER_TOPIC,
  METRICS_PER_TOPIC,
} from '../core/topic-knowledge-refiner.js';
import { probeCoverage } from './probe-cube-time-coverage.js';
import { cheapVerify } from './verify-starter-question-workability.js';
import { getSeedEntry } from '../db/starter-questions-seed.js';
import {
  KNOWLEDGE_SEED_PATH,
  KNOWLEDGE_TOPICS,
  type KnowledgeSeedFile,
  type KnowledgeSeedEntry,
  type KnowledgeTopic,
  type TopicKnowledge,
} from '../db/game-topic-knowledge-seed.js';
import type { StarterQuestion } from '../db/starter-questions-store.js';
import type { ToolContext } from '../types.js';

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

const normalise = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
const homeTopic = (q: StarterQuestion): KnowledgeTopic =>
  (q.topicTags[0] ?? 'liveops') as KnowledgeTopic;

function readKnowledgeSeed(): KnowledgeSeedFile | null {
  try {
    if (!existsSync(KNOWLEDGE_SEED_PATH)) return null;
    return JSON.parse(readFileSync(KNOWLEDGE_SEED_PATH, 'utf8')) as KnowledgeSeedFile;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function measureNamesOf(meta: any): Set<string> {
  const out = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const cube of meta?.cubes ?? []) for (const m of cube.measures ?? []) out.add(m.name);
  return out;
}

async function buildGameKnowledge(
  gameId: string,
  workspace: string,
): Promise<KnowledgeSeedEntry | null> {
  const ctx = { gameId, workspace } as ToolContext;
  const meta = await getMeta(gameId, workspace);
  const knownMembers = extractMemberNames(meta);
  const measures = measureNamesOf(meta);

  // The shipped starter chips are the verified core of the bank.
  const starterSeed = getSeedEntry(gameId);
  const shipped = starterSeed?.entry.questions ?? [];
  let coverage = await probeCoverage(meta, shipped, ctx, starterSeed?.entry.coverage ?? {});

  const todayIso = new Date().toISOString().slice(0, 10);
  const prompt = buildKnowledgePrompt(buildMetaProjection(meta), shipped, coverage, todayIso);
  const raw = await defaultCallLlm(prompt);
  const parsed = parseKnowledgeSet(
    raw,
    (rawArr) => parseAndValidateLlmSet(rawArr, knownMembers),
    measures,
  );
  if (!parsed) {
    console.error('  LLM knowledge set rejected (malformed or invented members)');
    return null;
  }
  if (parsed.droppedMetrics > 0) console.warn(`  dropped ${parsed.droppedMetrics} invalid metric rows`);

  // Tier-1 gate for the extras (shipped questions are already verified).
  const seen = new Set(shipped.map((q) => normalise(q.text)));
  const extras: StarterQuestion[] = [];
  coverage = await probeCoverage(meta, parsed.questions, ctx, coverage);
  for (const q of parsed.questions) {
    if (seen.has(normalise(q.text))) continue;
    seen.add(normalise(q.text));
    const res = await cheapVerify(q, meta, knownMembers, coverage, ctx);
    if (res.ok) extras.push({ ...q, depth: questionDepth(q) });
    else console.log(`    ✗ [${res.reason}] ${q.text.slice(0, 70)}`);
  }
  console.log(`  extras verified: ${extras.length}/${parsed.questions.length}`);

  const topics = {} as Record<KnowledgeTopic, TopicKnowledge>;
  for (const t of SEED_TOPICS) {
    const questions = [
      ...shipped.filter((q) => homeTopic(q) === t),
      ...extras.filter((q) => homeTopic(q) === t),
    ]
      .slice(0, KNOWLEDGE_QUESTIONS_PER_TOPIC)
      .map((q) => ({
        id: q.id,
        text: q.text,
        depth: q.depth ?? questionDepth(q),
        targetCatalogIds: q.targetCatalogIds,
      }));
    const metrics = parsed.metrics
      .filter((m) => m.topic === t)
      .slice(0, METRICS_PER_TOPIC)
      .map(({ member, title, why }) => ({ member, title, why }));
    topics[t] = { questions, metrics };
    console.log(`  ${t}: ${questions.length} questions, ${metrics.length} metrics`);
  }

  return { topics, coverage, generatedAt: Date.now() };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const games = args.games ?? Object.keys(JSON.parse(readFileSync(
    KNOWLEDGE_SEED_PATH.replace(/game-topic-knowledge-seed\.json$/, 'starter-questions-seed.json'),
    'utf8',
  )).games);
  if (games.length === 0) throw new Error('no games to generate for');

  const now = Date.now();
  const version = new Date(now).toISOString().slice(2, 10).replace(/-/g, '') + '-' + String(now % 10000).padStart(4, '0');
  console.log(`Pregenerating topic knowledge: workspace=${args.workspace} games=${games.join(',')} version=${version}`);

  // Merge-aware: a partial --games run keeps other games' entries.
  const seed: KnowledgeSeedFile = readKnowledgeSeed() ?? {
    version, generatedAt: now, workspaceGenerated: args.workspace, games: {},
  };

  const succeeded: string[] = [];
  for (const gameId of games) {
    console.log(`\n[${gameId}]`);
    try {
      const entry = await buildGameKnowledge(gameId, args.workspace);
      if (!entry) continue;
      seed.games[gameId] = entry;
      succeeded.push(gameId);
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message} — game keeps its previous knowledge entry`);
    }
  }
  if (succeeded.length === 0) throw new Error('no game produced a knowledge entry');

  seed.version = version;
  seed.generatedAt = now;
  seed.workspaceGenerated = args.workspace;
  writeFileSync(KNOWLEDGE_SEED_PATH, JSON.stringify(seed, null, 2) + '\n', 'utf8');
  console.log(`\nKnowledge seed written: ${KNOWLEDGE_SEED_PATH} (updated: ${succeeded.join(', ')})`);
  console.log(`Topics per game: ${KNOWLEDGE_TOPICS.join(' / ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
