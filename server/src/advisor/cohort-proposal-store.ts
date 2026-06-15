/**
 * Persistence for advisor cohort proposals — the bridge from a game-scope
 * investigation to a real Segment.
 *
 * A game-scope Drive can't scaffold an experiment draft (drafting is
 * segment-scoped). Instead the agent proposes a COHORT: a named predicate-tree
 * definition the UI turns into a Segment with one approval, after which the
 * scoped flow takes over. Keyed by session (no segment exists yet); re-proposing
 * in the same session replaces the prior row.
 *
 * PII-free: only a predicate definition + display name + rationale.
 */

import { getDb } from '../db/sqlite.js';
import type { PredicateNode } from '../types/predicate-tree.js';

export interface CohortProposal {
  sessionId: string;
  gameId: string;
  /** Human-facing segment name shown on the create button. */
  name: string;
  /** Primary cube the predicate is rooted in (Segment.cube on create). */
  primaryCube: string;
  /** The cohort definition — validated to compile before persistence. */
  predicateTree: PredicateNode;
  /** One or two sentences: why this cohort. */
  rationale: string;
  /** Optional agent estimate of addressable size (illustrative). */
  addressableN?: number;
  createdAt?: string;
}

interface ProposalRow {
  session_id: string;
  game_id: string;
  name: string;
  primary_cube: string;
  predicate_json: string;
  rationale: string;
  addressable_n: number | null;
  created_at: string;
}

/** Persist (idempotent upsert by session) a cohort proposal. */
export function saveCohortProposal(p: CohortProposal): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO advisor_cohort_proposal
       (session_id, game_id, name, primary_cube, predicate_json, rationale, addressable_n)
     VALUES (@session_id, @game_id, @name, @primary_cube, @predicate_json, @rationale, @addressable_n)
     ON CONFLICT(session_id) DO UPDATE SET
       game_id = excluded.game_id,
       name = excluded.name,
       primary_cube = excluded.primary_cube,
       predicate_json = excluded.predicate_json,
       rationale = excluded.rationale,
       addressable_n = excluded.addressable_n,
       created_at = datetime('now')`,
  ).run({
    session_id: p.sessionId,
    game_id: p.gameId,
    name: p.name,
    primary_cube: p.primaryCube,
    predicate_json: JSON.stringify(p.predicateTree),
    rationale: p.rationale,
    addressable_n: p.addressableN ?? null,
  });
}

/** Fetch the cohort proposal for a session, or null if none was proposed. */
export function getCohortProposal(sessionId: string): CohortProposal | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM advisor_cohort_proposal WHERE session_id = ?')
    .get(sessionId) as ProposalRow | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    gameId: row.game_id,
    name: row.name,
    primaryCube: row.primary_cube,
    predicateTree: JSON.parse(row.predicate_json) as PredicateNode,
    rationale: row.rationale,
    addressableN: row.addressable_n ?? undefined,
    createdAt: row.created_at,
  };
}
