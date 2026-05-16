/**
 * yaml-splice.test.ts
 * Unit tests for the yaml-splice pure function.
 */

import { describe, it, expect } from 'vitest';
import * as yaml from 'js-yaml';
import { splice } from '../yaml-splice.js';

// ---------------------------------------------------------------------------
// Fixtures — flat single-cube shape (legacy / one-cube-per-file)
// ---------------------------------------------------------------------------

const FLAT_WITH_MEASURES = `\
name: Orders
sql: SELECT * FROM orders
measures:
  - name: count
    sql: id
    type: count
dimensions:
  - name: status
    sql: status
    type: string`;

const FLAT_WITHOUT_MEASURES = `\
name: Orders
sql: SELECT * FROM orders
dimensions:
  - name: status
    sql: status
    type: string`;

// ---------------------------------------------------------------------------
// Fixtures — `cubes:` array shape (real-world Cube YAML, e.g. mf_users.yml)
// ---------------------------------------------------------------------------

const CUBES_ARRAY_WITH_MEASURES = `\
cubes:
  - name: mf_users
    sql_table: mf_users
    measures:
      - name: user_count
        sql: user_id
        type: count_distinct
    dimensions:
      - name: user_id
        sql: user_id
        type: string`;

const CUBES_ARRAY_MULTI_CUBE = `\
cubes:
  - name: orders
    sql_table: orders
    measures:
      - name: total
        sql: amount
        type: sum
  - name: users
    sql_table: users
    measures:
      - name: count
        sql: id
        type: count`;

const CUBES_ARRAY_WITHOUT_MEASURES = `\
cubes:
  - name: mf_users
    sql_table: mf_users
    dimensions:
      - name: user_id
        sql: user_id
        type: string`;

// ---------------------------------------------------------------------------
// Patches
// ---------------------------------------------------------------------------

const VALID_PATCH = `\
name: total_revenue
sql: amount
type: sum`;

const VALID_PATCH_2 = `\
name: avg_order
sql: amount
type: avg`;

// ---------------------------------------------------------------------------
// Happy path — flat shape
// ---------------------------------------------------------------------------

describe('splice (flat shape) — happy path', () => {
  it('returns prior content unchanged — suitable for rollback', () => {
    const { next, prior } = splice(FLAT_WITH_MEASURES, 'Orders', 'total_revenue', VALID_PATCH);
    expect(prior).toBe(FLAT_WITH_MEASURES);
    expect(next).not.toBe(prior);
  });

  it('round-trips: result is valid YAML containing the new measure', () => {
    const { next } = splice(FLAT_WITH_MEASURES, 'Orders', 'total_revenue', VALID_PATCH);

    const doc = yaml.load(next) as {
      measures: Array<{ name: string; sql: string; type: string }>;
    };

    expect(doc).toBeDefined();
    expect(Array.isArray(doc.measures)).toBe(true);

    const existing = doc.measures.find((m) => m.name === 'count');
    expect(existing).toBeDefined();

    const added = doc.measures.find((m) => m.name === 'total_revenue');
    expect(added).toBeDefined();
    expect(added?.sql).toBe('amount');
    expect(added?.type).toBe('sum');
  });

  it('creates a measures section when none exists', () => {
    const { next } = splice(FLAT_WITHOUT_MEASURES, 'Orders', 'total_revenue', VALID_PATCH);

    const doc = yaml.load(next) as { measures: Array<{ name: string }> };

    expect(Array.isArray(doc.measures)).toBe(true);
    expect(doc.measures).toHaveLength(1);
    expect(doc.measures[0].name).toBe('total_revenue');
  });

  it('preserves other top-level keys (name, sql, dimensions)', () => {
    const { next } = splice(FLAT_WITH_MEASURES, 'Orders', 'total_revenue', VALID_PATCH);

    const doc = yaml.load(next) as Record<string, unknown>;

    expect(doc['name']).toBe('Orders');
    expect(doc['sql']).toBe('SELECT * FROM orders');
    expect(Array.isArray(doc['dimensions'])).toBe(true);
  });

  it('uses 2-space indent — no tab characters in output', () => {
    const { next } = splice(FLAT_WITHOUT_MEASURES, 'Orders', 'total_revenue', VALID_PATCH);
    const hasTabIndent = next.split('\n').some((l) => l.startsWith('\t'));
    expect(hasTabIndent).toBe(false);
    const twoSpaceLines = next.split('\n').filter((l) => /^ {2}\S/.test(l));
    expect(twoSpaceLines.length).toBeGreaterThan(0);
  });

  it('appending a second measure keeps all entries in the array', () => {
    const { next: intermediate } = splice(
      FLAT_WITH_MEASURES,
      'Orders',
      'total_revenue',
      VALID_PATCH,
    );
    const { next } = splice(intermediate, 'Orders', 'avg_order', VALID_PATCH_2);

    const doc = yaml.load(next) as { measures: Array<{ name: string }> };

    const names = doc.measures.map((m) => m.name);
    expect(names).toContain('count');
    expect(names).toContain('total_revenue');
    expect(names).toContain('avg_order');
  });
});

// ---------------------------------------------------------------------------
// Happy path — `cubes:` array shape (regression coverage for the
// "measure orphaned at top level" bug)
// ---------------------------------------------------------------------------

describe('splice (cubes: array shape) — happy path', () => {
  it('splices into the matching cube, NOT at the document root', () => {
    const { next } = splice(
      CUBES_ARRAY_WITH_MEASURES,
      'mf_users',
      'total_revenue',
      VALID_PATCH,
    );

    const doc = yaml.load(next) as Record<string, unknown>;

    // Critical invariant: no top-level `measures:` key. The bug this
    // regression test guards against was creating one.
    expect(Object.prototype.hasOwnProperty.call(doc, 'measures')).toBe(false);

    const cubes = doc['cubes'] as Array<{ name: string; measures: Array<{ name: string }> }>;
    expect(Array.isArray(cubes)).toBe(true);

    const mfUsers = cubes.find((c) => c.name === 'mf_users');
    expect(mfUsers).toBeDefined();
    expect(mfUsers!.measures.map((m) => m.name)).toEqual(['user_count', 'total_revenue']);
  });

  it('creates a measures section inside the cube when none exists', () => {
    const { next } = splice(
      CUBES_ARRAY_WITHOUT_MEASURES,
      'mf_users',
      'total_revenue',
      VALID_PATCH,
    );

    const doc = yaml.load(next) as { cubes: Array<{ name: string; measures: Array<{ name: string }> }> };
    const mfUsers = doc.cubes.find((c) => c.name === 'mf_users');
    expect(mfUsers).toBeDefined();
    expect(mfUsers!.measures).toHaveLength(1);
    expect(mfUsers!.measures[0].name).toBe('total_revenue');
    expect(Object.prototype.hasOwnProperty.call(doc, 'measures')).toBe(false);
  });

  it('targets only the named cube in multi-cube files', () => {
    const { next } = splice(
      CUBES_ARRAY_MULTI_CUBE,
      'users',
      'total_revenue',
      VALID_PATCH,
    );

    const doc = yaml.load(next) as { cubes: Array<{ name: string; measures: Array<{ name: string }> }> };

    const orders = doc.cubes.find((c) => c.name === 'orders')!;
    const users = doc.cubes.find((c) => c.name === 'users')!;

    expect(orders.measures.map((m) => m.name)).toEqual(['total']);
    expect(users.measures.map((m) => m.name)).toEqual(['count', 'total_revenue']);
  });

  it('throws when the named cube is missing from cubes[]', () => {
    expect(() =>
      splice(CUBES_ARRAY_WITH_MEASURES, 'nope', 'total_revenue', VALID_PATCH),
    ).toThrow(/not found in cubes\[\]/);
  });

  it('throws when "cubes" is present but not an array', () => {
    const badShape = 'cubes:\n  name: not_an_array';
    expect(() =>
      splice(badShape, 'mf_users', 'total_revenue', VALID_PATCH),
    ).toThrow(/must be a sequence/);
  });
});

// ---------------------------------------------------------------------------
// Cross-shape contract
// ---------------------------------------------------------------------------

describe('splice — cross-shape contract', () => {
  it('flat-shape: throws when cubeName mismatches the document name', () => {
    expect(() =>
      splice(FLAT_WITH_MEASURES, 'NotOrders', 'total_revenue', VALID_PATCH),
    ).toThrow(/does not match cubeName/);
  });

  it('flat-shape: accepts a doc that omits top-level name (filename-derived cube)', () => {
    const noNameDoc = `\
sql: SELECT * FROM orders
dimensions:
  - name: status
    sql: status
    type: string`;
    const { next } = splice(noNameDoc, 'Orders', 'total_revenue', VALID_PATCH);
    const doc = yaml.load(next) as { measures: Array<{ name: string }> };
    expect(doc.measures[0].name).toBe('total_revenue');
  });
});

// ---------------------------------------------------------------------------
// Duplicate rejection
// ---------------------------------------------------------------------------

describe('splice — duplicate rejection', () => {
  it('throws when the measure name already exists in the named cube', () => {
    const dupPatch = 'name: count\nsql: id\ntype: count';
    expect(() => splice(FLAT_WITH_MEASURES, 'Orders', 'count', dupPatch)).toThrow(/already exists/);
  });

  it('cubes-array: throws when the measure name already exists in the named cube', () => {
    const dupPatch = 'name: user_count\nsql: user_id\ntype: count_distinct';
    expect(() =>
      splice(CUBES_ARRAY_WITH_MEASURES, 'mf_users', 'user_count', dupPatch),
    ).toThrow(/already exists in cube "mf_users"/);
  });

  it('throws when measureName is the reserved keyword "measures"', () => {
    expect(() => splice(FLAT_WITH_MEASURES, 'Orders', 'measures', VALID_PATCH)).toThrow(/reserved/);
  });

  it('throws for reserved keyword "sql"', () => {
    expect(() => splice(FLAT_WITHOUT_MEASURES, 'Orders', 'sql', VALID_PATCH)).toThrow(/reserved/);
  });

  it('throws for reserved keyword "joins"', () => {
    expect(() => splice(FLAT_WITHOUT_MEASURES, 'Orders', 'joins', VALID_PATCH)).toThrow(/reserved/);
  });
});

// ---------------------------------------------------------------------------
// Patch validation
// ---------------------------------------------------------------------------

describe('splice — patch validation', () => {
  it('throws when yamlPatch is missing "name"', () => {
    const badPatch = 'sql: amount\ntype: sum';
    expect(() =>
      splice(FLAT_WITHOUT_MEASURES, 'Orders', 'total_revenue', badPatch),
    ).toThrow(/missing required key.*name/);
  });

  it('throws when yamlPatch is missing "sql"', () => {
    const badPatch = 'name: total_revenue\ntype: sum';
    expect(() =>
      splice(FLAT_WITHOUT_MEASURES, 'Orders', 'total_revenue', badPatch),
    ).toThrow(/missing required key.*sql/);
  });

  it('throws when yamlPatch is missing "type"', () => {
    const badPatch = 'name: total_revenue\nsql: amount';
    expect(() =>
      splice(FLAT_WITHOUT_MEASURES, 'Orders', 'total_revenue', badPatch),
    ).toThrow(/missing required key.*type/);
  });

  it('throws when yamlPatch is a YAML scalar (not a mapping)', () => {
    expect(() =>
      splice(FLAT_WITHOUT_MEASURES, 'Orders', 'total_revenue', 'just a string'),
    ).toThrow(/mapping/);
  });

  it('throws when yamlPatch is a YAML sequence (not a mapping)', () => {
    const seqPatch = '- name: total_revenue\n  sql: amount\n  type: sum';
    expect(() =>
      splice(FLAT_WITHOUT_MEASURES, 'Orders', 'total_revenue', seqPatch),
    ).toThrow(/mapping/);
  });

  it('throws when patch.name does not match the declared measureName', () => {
    expect(() =>
      splice(FLAT_WITHOUT_MEASURES, 'Orders', 'other_name', VALID_PATCH),
    ).toThrow(/does not match/);
  });

  it('throws when the cube model YAML is not a top-level mapping', () => {
    const badModel = '- item1\n- item2';
    expect(() => splice(badModel, 'Orders', 'total_revenue', VALID_PATCH)).toThrow(
      /mapping at the top level/,
    );
  });
});
