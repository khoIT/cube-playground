/**
 * Live integration — does the real agent, investigating a WHOLE GAME, reliably
 * call `propose_cohort` with a predicate that COMPILES? This is the bridge that
 * unit tests can't cover: the tool itself is unit-tested, but whether the live
 * model actually invokes it (vs only narrating a cohort in prose) is a behaviour
 * fact that needs a real Drive turn on the OAuth + Cube lane.
 *
 * HOST-GATED: skipped unless a subscription OAuth token is present. The
 * pick-existing fallback guarantees no dead-end regardless of the model's
 * choice, so this test failing means "the auto-create path didn't fire", not
 * "the flow is broken".
 *
 * Asserts: after the turn, a cohort proposal is persisted for the session AND
 * its predicate tree compiles (predicateToSql) — i.e. the manager's one-click
 * "create segment" would succeed, not 500.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { createAdvisorAgentSession } from '../src/advisor/agent/agent-runtime.js';
import { resolveOAuthToken } from '../src/advisor/agent/agent-oauth-env.js';
import { getCohortProposal } from '../src/advisor/cohort-proposal-store.js';
import { predicateToSql } from '../src/services/predicate-to-sql.js';
import type { RuntimeEvent } from '../src/advisor/agent/agent-types.js';
import type { ScopeRef } from '../src/advisor/diagnosis-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const hasToken = !!resolveOAuthToken();
const TURN_TIMEOUT_MS = 240_000;

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe.skipIf(!hasToken)('live: agent proposes a compilable cohort (host-gated)', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it(
    'calls propose_cohort with a predicate that compiles',
    async () => {
      const sessionId = 'cohort-live-1';
      const scope: ScopeRef = { kind: 'game', gameId: 'cfm_vn' };
      const session = createAdvisorAgentSession(sessionId, {
        scope,
        goal: 'revenue',
        ctx: {
          cubeApiUrl: process.env.CUBEJS_API_URL ?? 'http://localhost:4000/cubejs-api/v1',
          token: process.env.CUBEJS_API_TOKEN ?? null,
        },
        owner: 'cohort-live',
      });

      const events: RuntimeEvent[] = [];
      try {
        for await (const ev of session.runTurn(
          'I want to win back lapsed payers in cfm_vn — players who used to pay but have ' +
            'gone quiet. Settle on exactly WHO to target and propose that cohort as a ' +
            'one-click-creatable segment so we can run a win-back experiment.',
          'drive',
        )) {
          events.push(ev);
        }
      } finally {
        session.abort('cohort-live-complete');
      }

      const done = events.find((e) => e.type === 'done');
      expect(done, `event types: ${JSON.stringify(events.map((e) => e.type))}`).toBeDefined();

      // The behaviour under test: a proposal was persisted for this session.
      const proposal = getCohortProposal(sessionId);
      expect(proposal, 'agent did not call propose_cohort (pick-existing fallback still works)').not.toBeNull();

      // And it compiles — the manager's create button would succeed.
      const sql = predicateToSql(proposal!.predicateTree, { asOf: '2026-06-15' });
      expect(sql).toBeTruthy();
      expect(sql.replace(/\s+/g, ' ').trim()).not.toBe('1=1');
    },
    TURN_TIMEOUT_MS,
  );
});
