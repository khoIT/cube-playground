/**
 * Orchestration for the per-game starter-question lifecycle:
 * pregenerated seed (frozen, identical everywhere) → deterministic template
 * baseline (pure function of the game's meta) → FE static fallback.
 *
 * No runtime LLM: LLM-quality sets come exclusively from
 * `npm run starters:pregenerate`, which freezes them into the checked-in seed
 * file — so environments never drift and serve paths never spend LLM calls.
 */

import type Database from 'better-sqlite3';
import { getMeta, getMetaVersion } from './cube-meta-cache.js';
import { buildTemplateQuestions } from './starter-question-templates.js';
import {
  getSet,
  upsertSet,
  type StarterQuestion,
  type StarterSetRow,
} from '../db/starter-questions-store.js';
import { getSeedEntry } from '../db/starter-questions-seed.js';

/**
 * Below this many template hits the schema is too sparse for a meaningful
 * per-game set — the FE substitutes its static library instead.
 */
const MIN_TEMPLATE_QUESTIONS = 3;

export interface StarterResponse {
  questions: StarterQuestion[];
  /** 'static-fallback' = nothing usable server-side; FE shows its static 18. */
  source: 'static-fallback' | 'template' | 'llm';
  status: 'template' | 'refining' | 'llm' | 'failed' | null;
  metaHash: string | null;
  generatedAt: number | null;
}

export interface GetOrGenerateArgs {
  workspace: string;
  gameId: string;
  logger: { warn: (obj: unknown, msg?: string) => void };
}

function toResponse(row: StarterSetRow): StarterResponse {
  return {
    questions: row.questions,
    // Stored 'seed' rows report as 'llm' — the set is LLM-authored and the FE
    // already maps that source; 'seed' provenance stays in the DB only.
    source: row.source === 'seed' ? 'llm' : row.source,
    status: row.status === 'seed' ? 'llm' : row.status,
    metaHash: row.meta_hash,
    generatedAt: row.updated_at,
  };
}

const STATIC_FALLBACK: StarterResponse = {
  questions: [],
  source: 'static-fallback',
  status: null,
  metaHash: null,
  generatedAt: null,
};

export async function getOrGenerateStarterQuestions(
  db: Database.Database,
  args: GetOrGenerateArgs,
): Promise<StarterResponse> {
  const { workspace, gameId, logger } = args;
  const row = getSet(db, workspace, gameId);

  // Pregenerated seed short-circuit: a game in the checked-in seed file is
  // served verbatim in EVERY environment — no meta_hash invalidation, no
  // background refine — so local and prod show identical questions. Updating
  // them = rerun `npm run starters:pregenerate` and commit the seed file.
  const seed = getSeedEntry(gameId);
  if (seed) {
    const seedHash = `seed:${seed.version}`;
    if (!row || row.source !== 'seed' || row.meta_hash !== seedHash) {
      upsertSet(db, {
        workspace, gameId, metaHash: seedHash,
        source: 'seed', questions: seed.entry.questions, status: 'seed',
      });
    }
    return {
      questions: seed.entry.questions,
      // Reported as 'llm' — the set IS LLM-authored, and the FE already maps
      // this source; 'seed' provenance lives in the DB row.
      source: 'llm',
      status: 'llm',
      metaHash: seedHash,
      generatedAt: seed.generatedAt,
    };
  }

  let liveHash: string;
  try {
    liveHash = await getMetaVersion(gameId, workspace);
  } catch (err) {
    // Upstream blip — serve the last saved set; never drop a good set
    // because a refresh failed.
    logger.warn({ err, workspace, gameId }, '[starter-questions] meta fetch failed');
    return row && row.questions.length > 0 ? toResponse(row) : STATIC_FALLBACK;
  }

  // Fresh row: serve it.
  if (row && row.meta_hash === liveHash) {
    return row.questions.length > 0 ? toResponse(row) : STATIC_FALLBACK;
  }

  // Miss or stale: run the synchronous template pass. Meta is normally
  // served from the cache the getMetaVersion call just populated, but the
  // TTL can expire between the two awaits — guard so a refetch blip still
  // degrades gracefully instead of leaking a 500 (never-500 contract).
  let baseline: StarterQuestion[];
  try {
    const meta = await getMeta(gameId, workspace);
    baseline = buildTemplateQuestions(meta);
  } catch (err) {
    logger.warn({ err, workspace, gameId }, '[starter-questions] meta fetch failed mid-request');
    return row && row.questions.length > 0 ? toResponse(row) : STATIC_FALLBACK;
  }

  if (baseline.length < MIN_TEMPLATE_QUESTIONS) {
    // Schema too sparse for a per-game set. Keep serving a stale-but-real
    // set if one exists; otherwise tell the FE to use its static library.
    return row && row.questions.length > 0 ? toResponse(row) : STATIC_FALLBACK;
  }

  // No runtime LLM refine: the deterministic template set is final for
  // unseeded games. LLM-quality questions come exclusively from
  // `npm run starters:pregenerate` (reviewed + committed seed file) so every
  // environment serves identical sets and prod spends no LLM calls here.
  upsertSet(db, {
    workspace, gameId, metaHash: liveHash,
    source: 'template', questions: baseline, status: 'template',
  });

  return {
    questions: baseline,
    source: 'template',
    status: 'template',
    metaHash: liveHash,
    generatedAt: Date.now(),
  };
}
