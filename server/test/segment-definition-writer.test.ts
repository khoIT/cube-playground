/**
 * segment-definition-writer — pure-logic + mocked-connector tests:
 * hash stability across re-saves, literal escaping in VALUES tuples, JSON
 * truncation cap, DELETE-then-INSERT idempotency shape, never-throws contract
 * (definition failure must not abort the membership loop), empty-input skip.
 * No real Trino.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock identity resolution (network/db-backed) and the Trino client BEFORE
// importing the module under test.
const resolveIdentityFieldMock = vi.fn();
vi.mock('../src/services/resolve-identity-field.js', () => ({
  resolveIdentityField: (...args: unknown[]) => resolveIdentityFieldMock(...args),
}));

const runQueryMock = vi.fn();
vi.mock('../src/services/trino-rest-client.js', () => ({
  runQuery: (...args: unknown[]) => runQueryMock(...args),
}));

import {
  definitionValuesTuple,
  writeSegmentDefinitions,
  type SegmentDefinitionSnapshotInput,
} from '../src/lakehouse/segment-definition-writer.js';
import { segmentDefinitionHash } from '../src/services/segment-definition-hash.js';
import type { Connector } from '../src/services/trino-profiler-config.js';

const connector: Connector = {
  id: 'test',
  label: 'test',
  workspaceId: 'local',
  sourceType: 'trino',
  host: 'unused',
  port: 8080,
  user: 'test',
  password: '',
  catalog: 'game_integration',
  ssl: false,
};

function seg(over: Partial<SegmentDefinitionSnapshotInput> = {}): SegmentDefinitionSnapshotInput {
  return {
    segmentId: 'seg-1',
    gameId: 'cfm_vn',
    cube: 'mf_users',
    workspace: 'local',
    name: 'High spenders',
    type: 'predicate',
    predicateTreeJson: '{"op":"and","children":[]}',
    cubeQueryJson: '{"dimensions":["mf_users.user_id"]}',
    ...over,
  };
}

beforeEach(() => {
  resolveIdentityFieldMock.mockReset();
  runQueryMock.mockReset();
  resolveIdentityFieldMock.mockResolvedValue('mf_users.user_id');
  runQueryMock.mockResolvedValue({ columns: [], rows: [[1]] });
});

describe('definitionValuesTuple', () => {
  it('embeds a stable definition hash — same tree re-serialized hashes identically', () => {
    // The JSON column is stored VERBATIM (raw strings differ), but the hash is
    // canonicalized — key-order variants of the same tree share one hash.
    const hash = segmentDefinitionHash({
      type: 'predicate',
      cube: 'mf_users',
      game_id: 'cfm_vn',
      predicate_tree_json: '{"b":1,"a":2}',
    });
    const a = definitionValuesTuple(
      seg({ predicateTreeJson: '{"b":1,"a":2}' }),
      '2026-06-12',
      'mf_users.user_id',
    );
    const b = definitionValuesTuple(
      seg({ predicateTreeJson: '{"a":2,"b":1}' }), // key order differs, same tree
      '2026-06-12',
      'mf_users.user_id',
    );
    expect(a).toContain(`'${hash}'`);
    expect(b).toContain(`'${hash}'`);
  });

  it('escapes quotes in name and JSON (injection-safe)', () => {
    const tuple = definitionValuesTuple(
      seg({ name: "O'Brien's whales", predicateTreeJson: `{"v":"x'); DROP TABLE t; --"}` }),
      '2026-06-12',
      null,
    );
    expect(tuple).toContain("'O''Brien''s whales'");
    expect(tuple).not.toMatch(/[^']'\); DROP/);
    expect(tuple).toContain('NULL'); // identity_field null → SQL NULL
  });

  it('truncates oversized JSON with a marker', () => {
    const big = '{"pad":"' + 'x'.repeat(120_000) + '"}';
    const tuple = definitionValuesTuple(seg({ predicateTreeJson: big }), '2026-06-12', null);
    expect(tuple.length).toBeLessThan(210_000);
    expect(tuple).toContain('…[truncated]');
  });
});

describe('writeSegmentDefinitions', () => {
  it('DELETEs the date slice then INSERTs all segments in one statement', async () => {
    const res = await writeSegmentDefinitions([seg(), seg({ segmentId: 'seg-2' })], '2026-06-12', {
      connector,
    });
    expect(res.status).toBe('written');
    const sqls = runQueryMock.mock.calls.map((c) => c[2] as string);
    expect(sqls[0]).toMatch(/^DELETE FROM .*segment_definition_daily WHERE snapshot_date = DATE '2026-06-12'$/);
    expect(sqls[1]).toMatch(/^INSERT INTO .*segment_definition_daily/);
    expect(sqls[1]).toContain("'seg-1'");
    expect(sqls[1]).toContain("'seg-2'");
    expect(sqls[2]).toMatch(/^SELECT count\(\*\)/);
  });

  it('degrades identity-resolution failure to NULL identity_field, row still lands', async () => {
    resolveIdentityFieldMock.mockRejectedValueOnce(new Error('cube meta down'));
    const res = await writeSegmentDefinitions([seg()], '2026-06-12', { connector });
    expect(res.status).toBe('written');
    const insert = runQueryMock.mock.calls[1][2] as string;
    expect(insert).toContain("'seg-1'");
  });

  it('never throws — Trino failure returns status error', async () => {
    runQueryMock.mockRejectedValue(new Error('coordinator unreachable'));
    const res = await writeSegmentDefinitions([seg()], '2026-06-12', { connector });
    expect(res.status).toBe('error');
    expect(res.error).toContain('coordinator unreachable');
  });

  it('rejects malformed snapshot dates and skips empty input without Trino calls', async () => {
    expect((await writeSegmentDefinitions([seg()], 'not-a-date', { connector })).status).toBe('error');
    const res = await writeSegmentDefinitions([], '2026-06-12', { connector });
    expect(res.status).toBe('skipped');
    expect(runQueryMock).not.toHaveBeenCalled();
  });
});
