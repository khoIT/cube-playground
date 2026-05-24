/**
 * check-metric-drift — CLI drift detector for the business-metrics registry.
 *
 * For each game in `gds.config.json`:
 *   1. Mint a Cube JWT via the standard resolver.
 *   2. Fetch `/cubejs-api/v1/meta`.
 *   3. Run every registry metric's formula refs through `validateRefs`.
 *
 * Prints a grouped report — by game, then by reason — and exits non-zero when
 * any ref is unresolved so this can wire into CI.
 *
 *   tsx src/scripts/check-metric-drift.ts                    # all games
 *   tsx src/scripts/check-metric-drift.ts --game ballistar   # one game
 *   tsx src/scripts/check-metric-drift.ts --json             # machine output
 *
 * Skips games gracefully when no token can be resolved (env not configured for
 * that tenant) — the resulting line in the report makes it explicit.
 */

import { loadGamesConfig } from '../services/games-config-loader.js';
import { resolveCubeTokenForGameDetailed } from '../services/resolve-cube-token.js';
import { getMeta } from '../services/cube-client.js';
import { loadAll, getAll } from '../services/business-metrics-loader.js';
import {
  snapshotFromMeta,
  validateRefs,
  type MetaResponse,
  type UnresolvedRef,
} from '../services/metric-ref-validator.js';

interface CliOpts {
  game: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { game: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--game' && i + 1 < argv.length) opts.game = argv[++i];
    else if (a === '--json') opts.json = true;
  }
  return opts;
}

interface GameReport {
  gameId: string;
  status: 'ok' | 'drift' | 'skipped' | 'error';
  tokenSource?: string;
  cubesInMeta?: number;
  membersInMeta?: number;
  unresolved?: UnresolvedRef[];
  message?: string;
}

async function checkGame(gameId: string): Promise<GameReport> {
  const tok = resolveCubeTokenForGameDetailed(gameId);
  if (!tok.token) {
    return {
      gameId,
      status: 'skipped',
      message: 'no Cube token (need CUBE_TOKEN_<GAME>, CUBEJS_API_SECRET, or CUBE_TOKEN)',
    };
  }

  let meta: MetaResponse;
  try {
    meta = (await getMeta(tok.token)) as MetaResponse;
  } catch (err) {
    return {
      gameId,
      status: 'error',
      tokenSource: tok.source,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const snap = snapshotFromMeta(meta);
  const unresolved = validateRefs(getAll(), snap);
  return {
    gameId,
    status: unresolved.length === 0 ? 'ok' : 'drift',
    tokenSource: tok.source,
    cubesInMeta: snap.cubes.size,
    membersInMeta: snap.members.size,
    unresolved,
  };
}

function printHuman(reports: GameReport[]): void {
  for (const r of reports) {
    const tail =
      r.status === 'ok'
        ? `meta=${r.cubesInMeta} cubes/${r.membersInMeta} members`
        : r.status === 'drift'
          ? `${r.unresolved!.length} unresolved ref(s)`
          : r.status === 'skipped'
            ? r.message
            : `ERROR — ${r.message}`;
    console.log(`[${r.gameId}] ${r.status.toUpperCase()} (${r.tokenSource ?? '-'}): ${tail}`);

    if (r.status === 'drift' && r.unresolved) {
      const byReason = new Map<string, UnresolvedRef[]>();
      for (const u of r.unresolved) {
        const bucket = byReason.get(u.reason) ?? [];
        bucket.push(u);
        byReason.set(u.reason, bucket);
      }
      for (const [reason, refs] of byReason) {
        console.log(`  ${reason} (${refs.length}):`);
        for (const u of refs) console.log(`    • ${u.metricId} → ${u.ref}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = loadGamesConfig();
  const targets = opts.game
    ? cfg.games.filter((g) => g.id === opts.game)
    : cfg.games;
  if (targets.length === 0) {
    console.error(`No matching games for "${opts.game ?? '-'}"`);
    process.exit(2);
  }

  await loadAll();

  const reports: GameReport[] = [];
  for (const g of targets) reports.push(await checkGame(g.id));

  if (opts.json) {
    console.log(JSON.stringify({ reports }, null, 2));
  } else {
    printHuman(reports);
  }

  // Non-zero exit if any report shows drift or a hard error. Skipped games do
  // not fail the run — they're operational gaps, not registry bugs.
  const failed = reports.some((r) => r.status === 'drift' || r.status === 'error');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('check-metric-drift: unexpected failure', err);
  process.exit(2);
});
