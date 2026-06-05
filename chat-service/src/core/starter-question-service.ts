/**
 * Orchestration for the per-game starter-question lifecycle:
 * read → staleness check → synchronous template baseline → background LLM
 * refine. Stale-while-revalidate: a stale set is still served while
 * regeneration runs; only a hard miss pays the (fast, meta-cached) template
 * pass inline. The LLM never blocks a response.
 */

import type Database from 'better-sqlite3';
import { getMeta, getMetaVersion } from './cube-meta-cache.js';
import { buildTemplateQuestions } from './starter-question-templates.js';
import { scheduleStarterRefine, type RefinerDeps } from './starter-question-refiner.js';
import {
  getSet,
  upsertSet,
  type StarterQuestion,
  type StarterSetRow,
} from '../db/starter-questions-store.js';

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
  /** Injected for tests; production uses the SDK default inside the refiner. */
  refinerDeps?: RefinerDeps;
}

function toResponse(row: StarterSetRow): StarterResponse {
  return {
    questions: row.questions,
    source: row.source,
    status: row.status,
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

  let liveHash: string;
  try {
    liveHash = await getMetaVersion(gameId, workspace);
  } catch (err) {
    // Upstream blip — serve the last saved set; never drop a good set
    // because a refresh failed.
    logger.warn({ err, workspace, gameId }, '[starter-questions] meta fetch failed');
    return row && row.questions.length > 0 ? toResponse(row) : STATIC_FALLBACK;
  }

  // Fresh row: serve it. If the LLM pass never settled for this hash,
  // (re)schedule it — the lease keeps this single-flight.
  if (row && row.meta_hash === liveHash) {
    if (row.status !== 'llm' && row.questions.length > 0) {
      scheduleStarterRefine({
        db, workspace, gameId, metaHash: liveHash,
        baseline: row.questions, logger, deps: args.refinerDeps,
      });
    }
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

  upsertSet(db, {
    workspace, gameId, metaHash: liveHash,
    source: 'template', questions: baseline, status: 'refining',
  });
  scheduleStarterRefine({
    db, workspace, gameId, metaHash: liveHash,
    baseline, logger, deps: args.refinerDeps,
  });

  return {
    questions: baseline,
    source: 'template',
    status: 'refining',
    metaHash: liveHash,
    generatedAt: Date.now(),
  };
}
