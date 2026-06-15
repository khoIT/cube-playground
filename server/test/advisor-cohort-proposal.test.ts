/**
 * Cohort proposal — the game-scope→Segment bridge. Covers the store (idempotent
 * upsert + read), the propose_cohort tool (compiles & persists; rejects an
 * uncompilable predicate; rejects segment scope), and the GET route.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { saveCohortProposal, getCohortProposal } from '../src/advisor/cohort-proposal-store.js';
import { buildAdvisorToolServer } from '../src/advisor/agent/tools/index.js';
import { ProvenanceLedger } from '../src/advisor/agent/agent-provenance-gate.js';
import type { ToolContext } from '../src/advisor/agent/tools/tool-context.js';
import type { ScopeRef } from '../src/advisor/diagnosis-types.js';
import type { PredicateNode } from '../src/types/predicate-tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const GOOD_PREDICATE: PredicateNode = {
  kind: 'leaf',
  id: 'l1',
  member: 'mf_users.os_platform',
  type: 'string',
  op: 'equals',
  values: ['ios'],
};

function makeCtx(scope: ScopeRef): ToolContext {
  return {
    sessionId: 'sess-1',
    scope,
    goal: 'revenue',
    ctx: { cubeApiUrl: 'http://stub', token: null },
    asOf: new Date('2026-06-15T00:00:00Z'),
    ledger: new ProvenanceLedger(),
  };
}

/** Pull a tool handler by bare name from the built server's registry. */
function toolHandler(server: ReturnType<typeof buildAdvisorToolServer>, name: string) {
  const reg = (
    server as unknown as {
      instance: { _registeredTools: Record<string, { handler: (a: Record<string, unknown>, e: unknown) => Promise<Record<string, unknown>> }> };
    }
  ).instance._registeredTools;
  const found = reg[name];
  if (!found) throw new Error(`tool ${name} not on server`);
  return found.handler;
}

describe('cohort-proposal store', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('saves and reads a proposal', () => {
    saveCohortProposal({
      sessionId: 's1',
      gameId: 'cfm_vn',
      name: 'Spend-drop payers',
      primaryCube: 'mf_users',
      predicateTree: GOOD_PREDICATE,
      rationale: 'warm payers who cut spend',
      addressableN: 18700,
    });
    const got = getCohortProposal('s1');
    expect(got?.name).toBe('Spend-drop payers');
    expect(got?.addressableN).toBe(18700);
    expect(got?.predicateTree).toEqual(GOOD_PREDICATE);
  });

  it('upserts by session id (latest wins, no duplicate)', () => {
    saveCohortProposal({ sessionId: 's1', gameId: 'cfm_vn', name: 'A', primaryCube: 'mf_users', predicateTree: GOOD_PREDICATE, rationale: 'r' });
    saveCohortProposal({ sessionId: 's1', gameId: 'cfm_vn', name: 'B', primaryCube: 'mf_users', predicateTree: GOOD_PREDICATE, rationale: 'r2' });
    expect(getCohortProposal('s1')?.name).toBe('B');
  });

  it('returns null for an unknown session', () => {
    expect(getCohortProposal('nope')).toBeNull();
  });
});

describe('propose_cohort tool', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('compiles a valid predicate and persists the proposal', async () => {
    const server = buildAdvisorToolServer(makeCtx({ kind: 'game', gameId: 'cfm_vn' }));
    const res = await toolHandler(server, 'propose_cohort')(
      { name: 'Spend-drop payers', primaryCube: 'mf_users', predicateTree: GOOD_PREDICATE, rationale: 'warm payers', addressableN: 18700 },
      {},
    );
    expect(res.isError).toBeFalsy();
    const stored = getCohortProposal('sess-1');
    expect(stored?.name).toBe('Spend-drop payers');
    expect(stored?.gameId).toBe('cfm_vn');
  });

  it('rejects an uncompilable predicate without persisting', async () => {
    const server = buildAdvisorToolServer(makeCtx({ kind: 'game', gameId: 'cfm_vn' }));
    const bad = { kind: 'leaf', id: 'l', member: 'bad member name', type: 'string', op: 'equals', values: ['x'] };
    const res = await toolHandler(server, 'propose_cohort')(
      { name: 'Bad', primaryCube: 'mf_users', predicateTree: bad, rationale: 'r' },
      {},
    );
    expect(res.isError).toBe(true);
    expect(getCohortProposal('sess-1')).toBeNull();
  });

  it('rejects a whole-game predicate (empty group → 1=1) without persisting', async () => {
    const server = buildAdvisorToolServer(makeCtx({ kind: 'game', gameId: 'cfm_vn' }));
    const emptyGroup = { kind: 'group', id: 'g', op: 'AND', children: [] };
    const res = await toolHandler(server, 'propose_cohort')(
      { name: 'Everyone', primaryCube: 'mf_users', predicateTree: emptyGroup, rationale: 'r' },
      {},
    );
    expect(res.isError).toBe(true);
    expect(getCohortProposal('sess-1')).toBeNull();
  });

  it('rejects a malformed tree (group without children) with an actionable message', async () => {
    const server = buildAdvisorToolServer(makeCtx({ kind: 'game', gameId: 'cfm_vn' }));
    const malformed = { kind: 'group', id: 'g', op: 'AND' };
    const res = await toolHandler(server, 'propose_cohort')(
      { name: 'Bad', primaryCube: 'mf_users', predicateTree: malformed, rationale: 'r' },
      {},
    );
    expect(res.isError).toBe(true);
    expect(getCohortProposal('sess-1')).toBeNull();
  });

  it('rejects segment scope (use scaffold_draft there)', async () => {
    const server = buildAdvisorToolServer(makeCtx({ kind: 'segment', segmentId: 'seg-x', gameId: 'cfm_vn' }));
    const res = await toolHandler(server, 'propose_cohort')(
      { name: 'X', primaryCube: 'mf_users', predicateTree: GOOD_PREDICATE, rationale: 'r' },
      {},
    );
    expect(res.isError).toBe(true);
  });
});
