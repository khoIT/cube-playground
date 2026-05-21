import { describe, it, expect } from 'vitest';
import { filterAndSortSegments } from '../library-filter-sort';
import type { Segment } from '../../../../types/segment-api';

function seg(over: Partial<Segment>): Segment {
  return {
    id: 'id',
    name: 'name',
    type: 'manual',
    owner: 'a@b',
    status: 'fresh',
    cube: null,
    predicate_tree: null,
    cube_query_json: null,
    sql_preview: null,
    uid_count: 0,
    uid_list: [],
    tags: [],
    refresh_cadence_min: null,
    last_refreshed_at: null,
    broken_reason: null,
    created_at: '2026-05-19T00:00:00Z',
    updated_at: '2026-05-19T00:00:00Z',
    game_id: 'ptg',
    activations: [],
    ...over,
  };
}

describe('filterAndSortSegments', () => {
  const segments: Segment[] = [
    seg({ id: '1', name: 'Alpha live',   type: 'predicate', uid_count: 100, updated_at: '2026-05-19T01:00:00Z' }),
    seg({ id: '2', name: 'Beta static',  type: 'manual',    uid_count: 500, updated_at: '2026-05-19T02:00:00Z' }),
    seg({ id: '3', name: 'gamma whales', type: 'manual',    uid_count: 250, updated_at: '2026-05-19T00:30:00Z', tags: ['whales'] }),
  ];

  it('filters by type=live', () => {
    const out = filterAndSortSegments(segments, { query: '', filter: 'live', sort: 'name' });
    expect(out.map((s) => s.id)).toEqual(['1']);
  });

  it('filters by type=static', () => {
    const out = filterAndSortSegments(segments, { query: '', filter: 'static', sort: 'name' });
    expect(out.map((s) => s.id)).toEqual(['2', '3']);
  });

  it('searches by name (case-insensitive)', () => {
    const out = filterAndSortSegments(segments, { query: 'GAMMA', filter: 'all', sort: 'name' });
    expect(out.map((s) => s.id)).toEqual(['3']);
  });

  it('searches by tag', () => {
    const out = filterAndSortSegments(segments, { query: 'whales', filter: 'all', sort: 'name' });
    expect(out.map((s) => s.id)).toEqual(['3']);
  });

  it('sorts by size descending', () => {
    const out = filterAndSortSegments(segments, { query: '', filter: 'all', sort: 'size' });
    expect(out.map((s) => s.uid_count)).toEqual([500, 250, 100]);
  });

  it('sorts by recent (descending updated_at)', () => {
    const out = filterAndSortSegments(segments, { query: '', filter: 'all', sort: 'recent' });
    expect(out.map((s) => s.id)).toEqual(['2', '1', '3']);
  });

  it('sorts by name (ascending)', () => {
    const out = filterAndSortSegments(segments, { query: '', filter: 'all', sort: 'name' });
    expect(out.map((s) => s.name)).toEqual(['Alpha live', 'Beta static', 'gamma whales']);
  });
});
