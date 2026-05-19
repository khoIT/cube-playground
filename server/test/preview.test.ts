import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preview, __resetPreviewCache } from '../src/services/preview-service.js';
import * as cubeClient from '../src/services/cube-client.js';
import type { PredicateNode } from '../src/types/predicate-tree.js';

const tree: PredicateNode = {
  kind: 'group',
  id: 'root',
  op: 'AND',
  children: [
    { kind: 'leaf', id: 'l1', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
  ],
};

describe('preview-service', () => {
  beforeEach(() => {
    __resetPreviewCache();
    vi.restoreAllMocks();
  });

  it('returns estimated_count + sql_preview when both upstream calls succeed', async () => {
    vi.spyOn(cubeClient, 'load').mockResolvedValue({
      results: [{ data: [{ 'mf_users.count': 12345 }] }],
    } as never);
    vi.spyOn(cubeClient, 'sql').mockResolvedValue({
      sql: { sql: ['SELECT * FROM mf_users WHERE country = ?', ['VN']] },
    } as never);

    const out = await preview(tree, 'mf_users');
    expect(out.estimated_count).toBe(12345);
    expect(out.sql_preview).toContain('SELECT *');
    expect(out.cached).toBe(false);
  });

  it('marks cached=true on second identical call', async () => {
    vi.spyOn(cubeClient, 'load').mockResolvedValue({
      results: [{ data: [{ 'mf_users.count': 42 }] }],
    } as never);
    vi.spyOn(cubeClient, 'sql').mockResolvedValue({ sql: { sql: ['SELECT 1', []] } } as never);

    const first = await preview(tree, 'mf_users');
    const second = await preview(tree, 'mf_users');
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.estimated_count).toBe(42);
  });

  it('returns null count when /load fails but still returns sql', async () => {
    vi.spyOn(cubeClient, 'load').mockRejectedValue(new Error('cube down'));
    vi.spyOn(cubeClient, 'sql').mockResolvedValue({ sql: { sql: ['SELECT 1', []] } } as never);

    const out = await preview(tree, 'mf_users');
    expect(out.estimated_count).toBeNull();
    expect(out.sql_preview).toContain('SELECT 1');
  });
});
