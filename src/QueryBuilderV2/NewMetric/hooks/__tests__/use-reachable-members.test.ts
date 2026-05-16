import { describe, it, expect, vi } from 'vitest';
import { buildJoinGraph, useReachableMembers } from '../use-reachable-members';
import { renderHook } from '@testing-library/react';
import { Cube } from '@cubejs-client/core';

// ---------------------------------------------------------------------------
// Fixture: 3 cubes — orders ↔ users (joined), products (standalone)
// ---------------------------------------------------------------------------

function makeSegment(name: string) {
  return { name, title: name, shortTitle: name, type: 'string' as const, public: true };
}

function makeDimension(name: string) {
  return {
    name,
    title: name,
    shortTitle: name.split('.')[1] ?? name,
    type: 'string' as const,
    suggestFilterValues: false,
    public: true,
  };
}

function makeMeasure(name: string) {
  return {
    name,
    title: name,
    shortTitle: name.split('.')[1] ?? name,
    type: 'count' as const,
    aggType: 'count' as const,
    cumulative: false,
    cumulativeTotal: false,
    drillMembersGrouped: { measures: [], dimensions: [] },
    drillMembers: [],
    public: true,
  };
}

// orders → users join
const ORDERS_CUBE = {
  name: 'orders',
  title: 'Orders',
  measures: [makeMeasure('orders.count'), makeMeasure('orders.revenue')],
  dimensions: [makeDimension('orders.id'), makeDimension('orders.status')],
  segments: [],
  folders: [],
  nestedFolders: [],
  hierarchies: [],
  // joins is present in the runtime API response but not in the TS type
  joins: [{ name: 'users', sql: 'orders.user_id = users.id' }],
} as unknown as Cube;

const USERS_CUBE = {
  name: 'users',
  title: 'Users',
  measures: [makeMeasure('users.count')],
  dimensions: [makeDimension('users.email'), makeDimension('users.id')],
  segments: [],
  folders: [],
  nestedFolders: [],
  hierarchies: [],
  joins: [],
} as unknown as Cube;

const PRODUCTS_CUBE = {
  name: 'products',
  title: 'Products',
  measures: [makeMeasure('products.count')],
  dimensions: [makeDimension('products.name')],
  segments: [],
  folders: [],
  nestedFolders: [],
  hierarchies: [],
  joins: [],
} as unknown as Cube;

const THREE_CUBES = [ORDERS_CUBE, USERS_CUBE, PRODUCTS_CUBE];

// ---------------------------------------------------------------------------
// buildJoinGraph tests
// ---------------------------------------------------------------------------

describe('buildJoinGraph()', () => {
  it('creates adjacency entries for all cubes including standalone ones', () => {
    const { adjacency } = buildJoinGraph(THREE_CUBES);
    expect(adjacency.has('orders')).toBe(true);
    expect(adjacency.has('users')).toBe(true);
    expect(adjacency.has('products')).toBe(true);
  });

  it('builds undirected edges: orders↔users', () => {
    const { adjacency } = buildJoinGraph(THREE_CUBES);
    expect(adjacency.get('orders')!.has('users')).toBe(true);
    expect(adjacency.get('users')!.has('orders')).toBe(true);
  });

  it('isolated cube has empty neighbour set', () => {
    const { adjacency } = buildJoinGraph(THREE_CUBES);
    expect(adjacency.get('products')!.size).toBe(0);
  });

  it('records join SQL by stable pair key', () => {
    const { joinSqlByPair } = buildJoinGraph(THREE_CUBES);
    const key = ['orders', 'users'].sort().join('|');
    expect(joinSqlByPair.get(key)).toBe('orders.user_id = users.id');
  });

  it('dedupes duplicate join entries (same pair declared from both sides)', () => {
    const doubleJoin = [
      {
        ...ORDERS_CUBE,
        joins: [{ name: 'users', sql: 'orders.user_id = users.id' }],
      } as unknown as Cube,
      {
        ...USERS_CUBE,
        joins: [{ name: 'orders', sql: 'orders.user_id = users.id' }],
      } as unknown as Cube,
    ];
    const { joinSqlByPair } = buildJoinGraph(doubleJoin);
    expect(joinSqlByPair.size).toBe(1);
  });

  it('ignores self-loops', () => {
    const selfLoop = [
      {
        ...ORDERS_CUBE,
        joins: [{ name: 'orders', sql: 'orders.id = orders.id' }],
      } as unknown as Cube,
    ];
    const { adjacency } = buildJoinGraph(selfLoop);
    expect(adjacency.get('orders')!.has('orders')).toBe(false);
  });

  it('handles cubes with no joins field', () => {
    const noJoins = [{ ...ORDERS_CUBE, joins: undefined } as unknown as Cube];
    const { adjacency } = buildJoinGraph(noJoins);
    expect(adjacency.get('orders')!.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// useReachableMembers tests — pure derivation via mock context
// ---------------------------------------------------------------------------

// Mock useQueryBuilderContext to inject the fixture cubes.
// Path is relative to this test file: ../../.. goes up __tests__ → hooks → NewMetric → QueryBuilderV2/context
vi.mock('../../../context', () => ({
  useQueryBuilderContext: vi.fn(),
}));

import { useQueryBuilderContext } from '../../../context';

function setupContext(cubes: Cube[]) {
  (useQueryBuilderContext as ReturnType<typeof vi.fn>).mockReturnValue({ cubes });
}

describe('useReachableMembers()', () => {
  it('returns empty when sourceCube is null', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers(null));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.joinedCubeCount).toBe(0);
    expect(result.current.reachableNames.size).toBe(0);
  });

  it('returns only source-cube members when no joins exist (products)', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers('products'));
    const { items, joinedCubeCount } = result.current;

    expect(joinedCubeCount).toBe(0);
    const cubeNames = [...new Set(items.map((i) => i.cubeName))];
    expect(cubeNames).toEqual(['products']);
    items.forEach((i) => expect(i.viaJoin).toBeUndefined());
  });

  it('returns orders.* + users.* when source is orders', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers('orders'));
    const { items, joinedCubeCount, reachableNames } = result.current;

    expect(joinedCubeCount).toBe(1);

    const orderItems = items.filter((i) => i.cubeName === 'orders');
    const userItems = items.filter((i) => i.cubeName === 'users');

    expect(orderItems.length).toBeGreaterThan(0);
    expect(userItems.length).toBeGreaterThan(0);

    orderItems.forEach((i) => expect(i.viaJoin).toBeUndefined());
    userItems.forEach((i) => {
      expect(i.viaJoin).toBeDefined();
      expect(i.viaJoin!.sql).toBe('orders.user_id = users.id');
      expect(i.viaJoin!.fromCube).toBe('orders');
    });

    // reachableNames covers all items
    items.forEach((i) => expect(reachableNames.has(i.memberName)).toBe(true));
  });

  it('users.* members carry viaJoin.sql verbatim', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers('orders'));
    const userEmail = result.current.items.find((i) => i.memberName === 'users.email');
    expect(userEmail).toBeDefined();
    expect(userEmail!.viaJoin!.sql).toBe('orders.user_id = users.id');
  });

  it('products members are NOT reachable from orders', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers('orders'));
    const productItem = result.current.items.find((i) => i.cubeName === 'products');
    expect(productItem).toBeUndefined();
  });

  it('source-cube members come before joined-cube members', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers('orders'));
    const { items } = result.current;
    const firstJoinedIndex = items.findIndex((i) => i.cubeName !== 'orders');
    const lastSourceIndex = items.map((i) => i.cubeName).lastIndexOf('orders');
    // All source members appear before any joined member
    expect(lastSourceIndex).toBeLessThan(firstJoinedIndex);
  });

  it('shortName is the unqualified part of memberName', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers('orders'));
    const item = result.current.items.find((i) => i.memberName === 'orders.status');
    expect(item?.shortName).toBe('status');
  });

  it('reachableNames set excludes out-of-graph cube members', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers('orders'));
    expect(result.current.reachableNames.has('products.count')).toBe(false);
  });

  it('useReachableMembers from users side also reaches orders (undirected)', () => {
    setupContext(THREE_CUBES);
    const { result } = renderHook(() => useReachableMembers('users'));
    const { items, joinedCubeCount } = result.current;
    expect(joinedCubeCount).toBe(1);
    const cubeNames = [...new Set(items.map((i) => i.cubeName))];
    expect(cubeNames).toContain('orders');
    expect(cubeNames).toContain('users');
  });
});
