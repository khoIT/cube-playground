/**
 * Cost-breakdown queries for the admin observability surface.
 *
 * Aggregates LLM spend over chat_turns ⋈ chat_sessions for a time window,
 * grouped by owner, game, workspace, and session (top-N by cost).
 *
 * Cost basis: the per-turn stored `cost_usd` (SDK-reported, includes cache
 * token pricing) when present; legacy turns with NULL cost fall back to
 * tokens × flat env rates. Cache-hit replay turns persist tokens=0 / cost=0
 * (see cache/replay-cached-turn.ts) so they never double-count spend.
 */

import type Database from 'better-sqlite3';

export interface CostRates {
  costPer1kInputUsd: number;
  costPer1kOutputUsd: number;
}

export interface CostBucket {
  cost_usd: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  sessions: number;
}

export interface OwnerCostRow extends CostBucket {
  owner_id: string;
  owner_label: string | null;
}

export interface GameCostRow extends CostBucket {
  game_id: string;
}

export interface WorkspaceCostRow extends CostBucket {
  workspace: string;
}

export interface AuthLaneCostRow extends CostBucket {
  /** 'primary'|'stg'|'backup' (gateway keys), 'subscription' (OAuth token),
   *  or 'unknown' for legacy turns recorded before the lane was stamped. */
  auth_label: string;
}

export interface SessionCostRow {
  session_id: string;
  title: string | null;
  owner_id: string;
  owner_label: string | null;
  game_id: string;
  workspace: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  last_turn_at: number | null;
}

export interface CostBreakdown {
  total: CostBucket;
  by_owner: OwnerCostRow[];
  by_game: GameCostRow[];
  by_workspace: WorkspaceCostRow[];
  /** Spend split by auth lane (gateway keys vs subscription quota). */
  by_auth: AuthLaneCostRow[];
  /** Top-N sessions by cost (N = sessionLimit). */
  sessions: SessionCostRow[];
  /** Total distinct sessions with assistant turns in the window (so the UI can show "top N of M"). */
  session_total: number;
}

/**
 * Per-turn cost: stored value wins; NULL (legacy turns) falls back to
 * tokens × flat rates. Stored 0 (cache hits) is non-NULL and stays 0.
 */
const COST_EXPR = `COALESCE(
  ct.cost_usd,
  COALESCE(ct.input_tokens, 0) / 1000.0 * @inRate
    + COALESCE(ct.output_tokens, 0) / 1000.0 * @outRate
)`;

/**
 * Shared FROM/WHERE for every aggregate: assistant turns in [fromMs, toMs].
 * Session `status` is intentionally NOT filtered (unlike the listing queries):
 * spend is immutable — archiving/compacting a session later doesn't un-spend
 * the money, so the rollup counts every turn ever paid for.
 */
const TURNS_IN_WINDOW = `FROM chat_turns ct
   JOIN chat_sessions cs ON cs.id = ct.session_id
   WHERE ct.role = 'assistant'
     AND ct.started_at >= @fromMs
     AND ct.started_at <= @toMs`;

const BUCKET_COLS = `COUNT(*) AS turns,
        SUM(COALESCE(ct.input_tokens, 0)) AS input_tokens,
        SUM(COALESCE(ct.output_tokens, 0)) AS output_tokens,
        SUM(${COST_EXPR}) AS cost_usd,
        COUNT(DISTINCT ct.session_id) AS sessions`;

export function queryCostBreakdown(
  db: Database.Database,
  params: { fromMs: number; toMs: number; sessionLimit: number; rates: CostRates },
): CostBreakdown {
  const bind = {
    fromMs: params.fromMs,
    toMs: params.toMs,
    inRate: params.rates.costPer1kInputUsd,
    outRate: params.rates.costPer1kOutputUsd,
  };

  const total = db
    .prepare(`SELECT ${BUCKET_COLS} ${TURNS_IN_WINDOW}`)
    .get(bind) as CostBucket & { cost_usd: number | null };

  const byOwner = db
    .prepare(
      `SELECT cs.owner_id, MAX(cs.owner_label) AS owner_label, ${BUCKET_COLS}
       ${TURNS_IN_WINDOW}
       GROUP BY cs.owner_id
       ORDER BY cost_usd DESC`,
    )
    .all(bind) as OwnerCostRow[];

  const byGame = db
    .prepare(
      `SELECT cs.game_id, ${BUCKET_COLS}
       ${TURNS_IN_WINDOW}
       GROUP BY cs.game_id
       ORDER BY cost_usd DESC`,
    )
    .all(bind) as GameCostRow[];

  const byWorkspace = db
    .prepare(
      `SELECT cs.workspace, ${BUCKET_COLS}
       ${TURNS_IN_WINDOW}
       GROUP BY cs.workspace
       ORDER BY cost_usd DESC`,
    )
    .all(bind) as WorkspaceCostRow[];

  const byAuth = db
    .prepare(
      `SELECT COALESCE(ct.llm_auth_label, 'unknown') AS auth_label, ${BUCKET_COLS}
       ${TURNS_IN_WINDOW}
       GROUP BY COALESCE(ct.llm_auth_label, 'unknown')
       ORDER BY cost_usd DESC`,
    )
    .all(bind) as AuthLaneCostRow[];

  const sessions = db
    .prepare(
      `SELECT ct.session_id, cs.title, cs.owner_id, cs.owner_label, cs.game_id, cs.workspace,
              COUNT(*) AS turns,
              SUM(COALESCE(ct.input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(ct.output_tokens, 0)) AS output_tokens,
              SUM(${COST_EXPR}) AS cost_usd,
              MAX(ct.started_at) AS last_turn_at
       ${TURNS_IN_WINDOW}
       GROUP BY ct.session_id
       ORDER BY cost_usd DESC
       LIMIT @limit`,
    )
    .all({ ...bind, limit: params.sessionLimit }) as SessionCostRow[];

  return {
    // SUM over zero rows yields NULL — normalize the empty-window case to zeros.
    total: {
      cost_usd: total.cost_usd ?? 0,
      turns: total.turns,
      input_tokens: total.input_tokens ?? 0,
      output_tokens: total.output_tokens ?? 0,
      sessions: total.sessions,
    },
    by_owner: byOwner,
    by_game: byGame,
    by_workspace: byWorkspace,
    by_auth: byAuth,
    sessions,
    session_total: total.sessions,
  };
}
