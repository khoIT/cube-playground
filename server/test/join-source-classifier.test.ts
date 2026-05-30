/**
 * Unit tests for cross-source join classification + the scaffolder's data_source
 * stamping. Same canonical source → 'same' (executes); different → 'cross' with a
 * rollupJoin advisory (declared, not executed).
 */
import { describe, it, expect } from 'vitest';
import { classifyJoin, crossSourceComment } from '../src/services/join-source-classifier.js';
import { scaffoldCubeModel } from '../src/services/cube-model-scaffolder.js';
import type { InferredSchema } from '../src/types/raw-schema.js';

describe('join-source-classifier', () => {
  it('classifies same-source joins (incl. trino/default equivalence)', () => {
    expect(classifyJoin('pg_prod', 'pg_prod').class).toBe('same');
    expect(classifyJoin('', '').class).toBe('same');
    expect(classifyJoin('trino', '').class).toBe('same'); // default ≡ trino
    expect(classifyJoin(undefined, 'default').class).toBe('same');
  });

  it('classifies cross-source joins with a rollupJoin advisory', () => {
    const c = classifyJoin('pg_prod', 'bq_prod');
    expect(c.class).toBe('cross');
    expect(c.advisory).toMatch(/rollupJoin/i);
    expect(crossSourceComment(c)).toMatch(/^# /);
  });

  it('treats a new source vs the default Trino model as cross-source', () => {
    expect(classifyJoin('pg_prod', '').class).toBe('cross');
  });
});

const inference: InferredSchema = {
  schema: 'analytics',
  mode: 'cold',
  cubes: [
    {
      name: 'events',
      sqlTable: 'events',
      primaryKey: 'id',
      fields: [
        { column: 'id', dataType: 'bigint', role: 'primary_key', confidence: 1, rationale: 'unique' },
        { column: 'amount', dataType: 'double', role: 'measure', confidence: 0.9, rationale: 'numeric', agg: 'sum' },
      ],
      joins: [],
    },
  ],
};

describe('scaffolder data_source stamping', () => {
  it('stamps data_source for a non-default connector', () => {
    const { model } = scaffoldCubeModel(inference, new Set(), 'pg_prod');
    expect(model.cubes[0].data_source).toBe('pg_prod');
  });

  it('omits data_source when none given (default Trino behavior)', () => {
    const { model } = scaffoldCubeModel(inference);
    expect(model.cubes[0].data_source).toBeUndefined();
  });
});
