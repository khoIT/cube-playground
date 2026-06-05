/**
 * CLI: `npm run starters:pregenerate [-- --games a,b --workspace local]`
 *
 * Pregenerates the per-game starter-question sets ONCE and freezes them in
 * seed/starter-questions-seed.json (checked into git, shipped in the prod
 * image — see Dockerfile chat-service stage) + the local DB.
 * Every environment that ships the seed file serves these exact questions —
 * see src/db/starter-questions-seed.ts for the serve-side contract.
 *
 * Per game: template baseline → time-coverage probes (latest date with data
 * per referenced cube, same window walk as the get_time_coverage tool) →
 * synchronous LLM refine with the coverage in the prompt (questions must be
 * answerable in the data that actually exists) → strict member validation →
 * seed entry. Games with a too-sparse schema are skipped (FE static library
 * covers them, same as the dynamic pipeline).
 */

import { writeFileSync } from 'node:fs';
import { config } from '../config.js';
import { getMeta, extractMemberNames } from '../core/cube-meta-cache.js';
import { buildTemplateQuestions } from '../core/starter-question-templates.js';
import {
  buildMetaProjection,
  buildRefinePrompt,
  parseAndValidateLlmSet,
  defaultCallLlm,
  SEED_QUESTIONS_PER_GAME,
} from '../core/starter-question-refiner.js';
import { handler as timeCoverageHandler } from '../tools/get-time-coverage.js';
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
const MAX_COVERAGE_PROBES = 8;

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
 * reference. Returns `{timeDim: 'YYYY-MM-DD'}` for found dims only.
 * `known` short-circuits dims probed in an earlier pass — the post-LLM
 * top-up only pays for cubes the baseline didn't already cover.
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

/** Refine prompt + the data-coverage contract appended. */
function buildPromptWithCoverage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
  baseline: StarterQuestion[],
  coverage: Record<string, string>,
  todayIso: string,
): string {
  const base = buildRefinePrompt(buildMetaProjection(meta), baseline);
  const lines = [
    base,
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
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const games = args.games ?? (await listReadyGames(args.workspace));
  if (games.length === 0) throw new Error('no games to generate for');

  const now = Date.now();
  const todayIso = new Date(now).toISOString().slice(0, 10);
  // Version doubles as the served meta_hash — date-stamped for traceability.
  const version = todayIso.replace(/-/g, '').slice(2) + '-' + String(now % 10000).padStart(4, '0');

  console.log(`Pregenerating starter questions: workspace=${args.workspace} games=${games.join(',')} version=${version}`);

  const seedGames: Record<string, StarterSeedEntry> = {};
  for (const gameId of games) {
    console.log(`\n[${gameId}]`);
    const ctx = { gameId, workspace: args.workspace } as ToolContext;

    const meta = await getMeta(gameId, args.workspace);
    const baseline = buildTemplateQuestions(meta);
    if (baseline.length < MIN_TEMPLATE_QUESTIONS) {
      console.log(`  skipped — schema too sparse (${baseline.length} template questions)`);
      continue;
    }

    const coverage = await probeCoverage(meta, baseline, ctx);
    console.log(`  coverage: ${JSON.stringify(coverage)}`);

    const prompt = buildPromptWithCoverage(meta, baseline, coverage, todayIso);
    console.log(`  refining (${baseline.length} baseline questions)…`);
    const raw = await defaultCallLlm(prompt);
    const validated = parseAndValidateLlmSet(raw, extractMemberNames(meta));
    if (!validated) {
      console.error(`  REJECTED — LLM set failed validation; game left out of seed`);
      continue;
    }
    // The prompt asks for exactly SEED_QUESTIONS_PER_GAME; clamp defensively
    // so an over-eager response can't bloat the landing grid.
    const questions = validated.slice(0, SEED_QUESTIONS_PER_GAME);
    console.log(`  ✓ ${questions.length} questions validated`);
    // The LLM may pick cubes the baseline never referenced — top up coverage
    // for those so the click-through pass can anchor its time window to data.
    const fullCoverage = await probeCoverage(meta, questions, ctx, coverage);
    seedGames[gameId] = { questions, coverage: fullCoverage };
  }

  if (Object.keys(seedGames).length === 0) throw new Error('no game produced a valid set — seed not written');

  const seed: StarterSeedFile = {
    version,
    generatedAt: now,
    workspaceGenerated: args.workspace,
    games: seedGames,
  };
  writeFileSync(STARTER_SEED_PATH, JSON.stringify(seed, null, 2) + '\n', 'utf8');
  console.log(`\nSeed written: ${STARTER_SEED_PATH} (${Object.keys(seedGames).length} games)`);

  // Mirror into the local DB so this environment serves the seed immediately
  // (the serve path would lazily upsert anyway; this keeps the DB inspectable).
  const db = openDatabase(config.chatDbPath);
  for (const [gameId, entry] of Object.entries(seedGames)) {
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
