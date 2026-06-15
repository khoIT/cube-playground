/**
 * propose_cohort tool — the bridge from a game-scope investigation to a Segment.
 *
 * A game-scope Drive can't scaffold an experiment draft (drafting is
 * segment-scoped). When the agent has settled on WHO the experiment should target,
 * it calls this to propose a named cohort: a predicate-tree definition the manager
 * one-click turns into a Segment, after which the scoped flow (scaffold → review →
 * monitor) takes over.
 *
 * The predicate is validated to COMPILE here (predicateToSql against the session
 * anchor) — a proposal the Segments engine can't materialize is rejected, not
 * persisted, so the manager never gets a create button that 500s.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { predicateToSql } from '../../../services/predicate-to-sql.js';
import type { PredicateNode } from '../../../types/predicate-tree.js';
import { saveCohortProposal } from '../../cohort-proposal-store.js';
import { ok, fail, type ToolContext } from './tool-context.js';

const NAME = 'propose_cohort';

/**
 * Shallow shape check of the agent-supplied predicate tree (zod only sees a bag
 * of keys). Returns an error message, or null if the top-level node is usable.
 * Deeper malformed nodes are caught by the compile step's try/catch — this guard
 * exists so the COMMON failures (empty group / wrong kind / leaf missing member)
 * give the agent an actionable message instead of an opaque TypeError.
 */
function shapeError(tree: Record<string, unknown>): string | null {
  const kind = tree.kind;
  if (kind !== 'leaf' && kind !== 'group') {
    return 'predicate root must be a node with kind "leaf" or "group"';
  }
  if (kind === 'group') {
    if (!Array.isArray(tree.children) || tree.children.length === 0) {
      return 'an empty group selects the whole game — add at least one leaf defining who is in the cohort';
    }
  } else if (typeof tree.member !== 'string' || typeof tree.op !== 'string') {
    return 'a leaf needs a member (column) and an op';
  }
  return null;
}

/** A predicate that compiles to a trivially-true clause = the whole game, not a cohort. */
function isWholeGame(sql: string): boolean {
  const n = sql.replace(/\s+/g, ' ').trim();
  return n === '1=1' || n === '(1=1)';
}

export function makeProposeCohortTool(tctx: ToolContext) {
  return tool(
    NAME,
    'Propose a target COHORT as a one-click-creatable Segment, for when you are ' +
      'investigating a whole game (no segment scope) and cannot scaffold a draft yet. ' +
      'Give a short human name, the primary cube, a predicate tree defining who is in ' +
      'the cohort (relative-date and percentile operators are supported), and a one-line ' +
      'rationale. The predicate is validated to compile before it is saved; fix any ' +
      'compile error and retry. After this, the manager creates the segment and the ' +
      'scoped experiment flow continues.',
    {
      name: z.string().min(3).describe('human segment name, e.g. "Spend-drop payers (last 30d)"'),
      primaryCube: z.string().describe('the cube the predicate is rooted in, e.g. "mf_users"'),
      predicateTree: z.record(z.string(), z.unknown()).describe('a PredicateNode tree defining the cohort'),
      rationale: z.string().describe('one or two sentences: why this cohort'),
      addressableN: z.number().int().nonnegative().optional().describe('optional estimate of addressable size'),
    },
    async (args: {
      name: string;
      primaryCube: string;
      predicateTree: Record<string, unknown>;
      rationale: string;
      addressableN?: number;
    }) => {
      if (tctx.scope.kind !== 'game') {
        return fail('propose_cohort is for game scope; in a segment scope use scaffold_draft directly');
      }
      const shapeErr = shapeError(args.predicateTree);
      if (shapeErr) return fail(`${shapeErr}. Fix the predicate tree and call propose_cohort again.`);
      const asOf = tctx.asOf.toISOString().slice(0, 10);
      let sql: string;
      try {
        sql = predicateToSql(args.predicateTree as unknown as PredicateNode, { asOf });
      } catch (err) {
        return fail(
          `predicate does not compile: ${err instanceof Error ? err.message : String(err)}. ` +
            'Fix the predicate tree and call propose_cohort again.',
        );
      }
      // A cohort that selects everyone is not an experiment target — reject it so
      // the manager never gets a one-click "create the whole game" segment.
      if (isWholeGame(sql)) {
        return fail(
          'this predicate selects the whole game (compiles to 1=1) — add at least one real ' +
            'filter defining who is in the cohort, then call propose_cohort again.',
        );
      }
      saveCohortProposal({
        sessionId: tctx.sessionId,
        gameId: tctx.scope.gameId,
        name: args.name,
        primaryCube: args.primaryCube,
        predicateTree: args.predicateTree as unknown as PredicateNode,
        rationale: args.rationale,
        addressableN: args.addressableN,
      });
      return ok(
        `Cohort proposed: "${args.name}". The manager can now create this segment in one click; ` +
          `compiled WHERE clause:\n${sql}`,
        { name: args.name, primaryCube: args.primaryCube },
      );
    },
  );
}
