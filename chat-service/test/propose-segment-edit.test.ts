/**
 * Unit tests for propose_segment_edit + its pure tree-apply helper.
 *
 * Covers:
 *   applyEditOps  — add_filter (AND-wrap + append), remove_filter (prune +
 *                   empty-guard), replace_tree, cross-cube reject.
 *   handler       — admin-gate (can_administer:false → forbidden), no-predicate
 *                   guard, 404 → not_found, happy path emits a segment_proposal
 *                   with an `edit` block + the merged tree.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { EventEmitter } from 'node:events';
import { applyEditOps } from '../src/tools/segment-edit-ops.js';
import type { PredicateNode, GroupNode } from '../src/types/predicate-tree.js';
import type { ToolContext } from '../src/types.js';

// Mock the server-client (getJson loads the segment; postJson is the preview count).
vi.mock('../src/services/server-client.js', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  ServerClientError: class ServerClientError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
      super(`HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import * as serverClient from '../src/services/server-client.js';
import { handler } from '../src/tools/propose-segment-edit.js';
const mockGetJson = serverClient.getJson as MockedFunction<typeof serverClient.getJson>;
const mockPostJson = serverClient.postJson as MockedFunction<typeof serverClient.postJson>;

beforeEach(() => {
  mockGetJson.mockReset();
  mockPostJson.mockReset();
});

function makeCtx(): { ctx: ToolContext; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  const ctx: ToolContext = {
    ownerId: 'test-owner',
    gameId: 'cfm_vn',
    cubeToken: 'tok',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'turn-1',
    sseEmitter: emitter,
  };
  return { ctx, emitter };
}

const TREE_AND: GroupNode = {
  kind: 'group',
  id: 'g1',
  op: 'AND',
  children: [{ kind: 'leaf', id: 'l1', member: 'mf_users.ltv_vnd', type: 'number', op: 'gte', values: [1000] }],
};

// ---------------------------------------------------------------------------
// Pure apply helper
// ---------------------------------------------------------------------------

describe('applyEditOps', () => {
  it('appends an add_filter leaf into an existing AND group', () => {
    const r = applyEditOps(TREE_AND, [{ kind: 'add_filter', member: 'mf_users.country', operator: 'equals', values: ['VN'] }], 'mf_users');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tree = r.tree as GroupNode;
    expect(tree.op).toBe('AND');
    expect(tree.children).toHaveLength(2);
    expect(r.added[0]).toContain('mf_users.country');
    // Source tree is untouched (deep clone).
    expect(TREE_AND.children).toHaveLength(1);
  });

  it('wraps a bare leaf root in a new AND group when adding', () => {
    const leafRoot: PredicateNode = { kind: 'leaf', id: 'l1', member: 'mf_users.ltv_vnd', type: 'number', op: 'gte', values: [1000] };
    const r = applyEditOps(leafRoot, [{ kind: 'add_filter', member: 'mf_users.country', operator: 'equals', values: ['VN'] }], 'mf_users');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tree.kind).toBe('group');
    expect((r.tree as GroupNode).children).toHaveLength(2);
  });

  it('removes leaves by member and prunes', () => {
    const two: GroupNode = {
      kind: 'group', id: 'g', op: 'AND',
      children: [
        { kind: 'leaf', id: 'a', member: 'mf_users.ltv_vnd', type: 'number', op: 'gte', values: [1000] },
        { kind: 'leaf', id: 'b', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
      ],
    };
    const r = applyEditOps(two, [{ kind: 'remove_filter', member: 'mf_users.country' }], 'mf_users');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.tree as GroupNode).children).toHaveLength(1);
    expect(r.removed).toEqual(['mf_users.country']);
  });

  it('errors when remove_filter would empty the predicate', () => {
    const r = applyEditOps(TREE_AND, [{ kind: 'remove_filter', member: 'mf_users.ltv_vnd' }], 'mf_users');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_filters');
  });

  it('rejects an add_filter member on a different cube', () => {
    const r = applyEditOps(TREE_AND, [{ kind: 'add_filter', member: 'other.foo', operator: 'equals', values: ['x'] }], 'mf_users');
    expect(r.ok).toBe(false);
  });

  it('replace_tree swaps the whole tree', () => {
    const repl: PredicateNode = { kind: 'leaf', id: 'z', member: 'mf_users.dau', type: 'number', op: 'gte', values: [5] };
    const r = applyEditOps(TREE_AND, [{ kind: 'replace_tree', predicate_tree: repl }], 'mf_users');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tree).toMatchObject({ kind: 'leaf', member: 'mf_users.dau' });
  });
});

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

describe('propose_segment_edit handler', () => {
  it('emits a segment_proposal with an edit block and the merged tree', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: Array<Record<string, unknown>> = [];
    emitter.on('segment_proposal', (p) => proposals.push(p as Record<string, unknown>));

    mockGetJson.mockResolvedValueOnce({
      id: 'seg-1', name: 'Whales', cube: 'mf_users', can_administer: true, predicate_tree: TREE_AND,
    });
    mockPostJson.mockResolvedValueOnce({ ok: true, estCount: 4321 });

    const result = await handler(
      { segment_id: 'seg-1', ops: [{ kind: 'add_filter', member: 'mf_users.country', operator: 'equals', values: ['VN'] }], language: 'en' },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estCount).toBe(4321);
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.type).toBe('segment_proposal');
    expect(p.edit).toMatchObject({ segment_id: 'seg-1' });
    const tree = p.predicate_tree as GroupNode;
    expect(tree.children).toHaveLength(2);
    expect((p.resolved as { estCount: number }).estCount).toBe(4321);
  });

  it('refuses with forbidden when the principal cannot administer', async () => {
    const { ctx } = makeCtx();
    mockGetJson.mockResolvedValueOnce({
      id: 'seg-1', name: 'Shared cohort', cube: 'mf_users', can_administer: false, predicate_tree: TREE_AND,
    });
    const result = await handler(
      { segment_id: 'seg-1', ops: [{ kind: 'remove_filter', member: 'mf_users.ltv_vnd' }] },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('forbidden');
  });

  it('returns no_predicate for a segment without a predicate tree', async () => {
    const { ctx } = makeCtx();
    mockGetJson.mockResolvedValueOnce({ id: 'seg-1', name: 'Static', cube: 'mf_users', can_administer: true, predicate_tree: null });
    const result = await handler({ segment_id: 'seg-1', ops: [{ kind: 'add_filter', member: 'mf_users.country', operator: 'equals', values: ['VN'] }] }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_predicate');
  });

  it('returns not_found on a 404 from the server', async () => {
    const { ctx } = makeCtx();
    mockGetJson.mockRejectedValueOnce(new serverClient.ServerClientError(404, { error: 'not found' }));
    const result = await handler({ segment_id: 'missing', ops: [{ kind: 'remove_filter', member: 'mf_users.x' }] }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('still emits when the preview count is unavailable (estCount 0)', async () => {
    const { ctx, emitter } = makeCtx();
    const proposals: Array<Record<string, unknown>> = [];
    emitter.on('segment_proposal', (p) => proposals.push(p as Record<string, unknown>));
    mockGetJson.mockResolvedValueOnce({ id: 'seg-1', name: 'Whales', cube: 'mf_users', can_administer: true, predicate_tree: TREE_AND });
    mockPostJson.mockRejectedValueOnce(new Error('count timed out'));

    const result = await handler(
      { segment_id: 'seg-1', ops: [{ kind: 'add_filter', member: 'mf_users.country', operator: 'equals', values: ['VN'] }] },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estCount).toBe(0);
    expect(proposals).toHaveLength(1);
  });
});
