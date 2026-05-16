import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNewMetricDraft, validate } from '../use-new-metric-draft';
import { NewMetricDraft } from '../../types';

// A fully valid draft for use as a baseline in validation tests.
// The new shape uses canonical `sourceCubes` + `inputs`; legacy
// `sourceCube` / `ofMember` / `ofMemberB` are kept synced for the dialog flow.
const VALID_DRAFT: NewMetricDraft = {
  sourceCubes: ['orders'],
  sourceCube: 'orders',
  operation: 'sum',
  inputs: { value: 'orders.amount' },
  ofMember: 'orders.amount',
  ofMemberB: null,
  filter: null,
  name: 'total_revenue',
  title: 'Total Revenue',
  description: '',
  format: 'number',
  tags: [],
  previewTimeDimension: null,
  previewRange: '7d',
};

// ─── validate() unit tests ────────────────────────────────────────────────────

describe('validate()', () => {
  it('returns isValid=true for a fully valid draft', () => {
    expect(validate(VALID_DRAFT).isValid).toBe(true);
  });

  it('errors when no source cube is selected', () => {
    const result = validate({ ...VALID_DRAFT, sourceCubes: [], sourceCube: null });
    expect(result.isValid).toBe(false);
    expect(result.errors.sourceCubes).toBeDefined();
  });

  it('errors when required slot is empty', () => {
    const result = validate({ ...VALID_DRAFT, inputs: {}, ofMember: null });
    expect(result.isValid).toBe(false);
    expect(result.errors['inputs.value']).toBeDefined();
  });

  it('errors when name is empty', () => {
    const result = validate({ ...VALID_DRAFT, name: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  it('errors when name violates snake_case (camelCase)', () => {
    const result = validate({ ...VALID_DRAFT, name: 'totalRevenue' });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toMatch(/snake_case/i);
  });

  it('errors when name starts with a digit', () => {
    const result = validate({ ...VALID_DRAFT, name: '1bad' });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  it('errors when name starts with underscore', () => {
    const result = validate({ ...VALID_DRAFT, name: '_bad' });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBeDefined();
  });

  it('accepts valid snake_case names', () => {
    expect(validate({ ...VALID_DRAFT, name: 'active_users_count' }).isValid).toBe(true);
    expect(validate({ ...VALID_DRAFT, name: 'a' }).isValid).toBe(true);
    expect(validate({ ...VALID_DRAFT, name: 'rev2024' }).isValid).toBe(true);
  });

  it('errors when title is empty', () => {
    const result = validate({ ...VALID_DRAFT, title: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.title).toBeDefined();
  });

  it('errors when ratio is missing its denominator slot', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'ratio',
      sourceCubes: ['orders', 'users'],
      inputs: { numerator: 'orders.amount' },
      ofMember: 'orders.amount',
      ofMemberB: null,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors['inputs.denominator']).toBeDefined();
  });

  it('errors on ratio when only one source cube is selected', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'ratio',
      sourceCubes: ['orders'],
      inputs: { numerator: 'orders.revenue', denominator: 'orders.count' },
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.sourceCubes).toMatch(/at least 2/i);
  });

  it('accepts cross-cube ratio when both cubes are selected', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'ratio',
      sourceCubes: ['orders', 'users'],
      inputs: { numerator: 'orders.revenue', denominator: 'users.count' },
      ofMember: 'orders.revenue',
      ofMemberB: 'users.count',
    });
    expect(result.isValid).toBe(true);
  });

  it('accepts ratio when both operands belong to the primary source cube', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'ratio',
      sourceCubes: ['orders', 'orders_detail'],
      inputs: { numerator: 'orders.revenue', denominator: 'orders.count' },
      ofMember: 'orders.revenue',
      ofMemberB: 'orders.count',
    });
    expect(result.isValid).toBe(true);
  });

  it('count with optional value slot accepts an empty input', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'count',
      inputs: {},
      ofMember: null,
    });
    expect(result.isValid).toBe(true);
  });

  it('accumulates multiple errors at once', () => {
    const result = validate({
      ...VALID_DRAFT,
      sourceCubes: [],
      sourceCube: null,
      inputs: {},
      ofMember: null,
      name: '',
      title: '',
    });
    expect(result.isValid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThanOrEqual(4);
  });
});

// ─── useNewMetricDraft() hook tests ──────────────────────────────────────────

describe('useNewMetricDraft()', () => {
  it('initialises with default draft values', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    expect(result.current.draft.sourceCubes).toEqual([]);
    expect(result.current.draft.sourceCube).toBeNull();
    expect(result.current.draft.operation).toBe('sum');
    expect(result.current.draft.inputs).toEqual({});
    expect(result.current.draft.name).toBe('');
    expect(result.current.draft.format).toBe('number');
  });

  it('setField updates a string field', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('name', 'my_metric'));
    expect(result.current.draft.name).toBe('my_metric');
  });

  it('setField on sourceCube also writes through to sourceCubes', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('sourceCube', 'orders'));
    expect(result.current.draft.sourceCube).toBe('orders');
    expect(result.current.draft.sourceCubes).toEqual(['orders']);
  });

  it('setField on sourceCubes syncs legacy sourceCube field', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('sourceCubes', ['orders', 'users']));
    expect(result.current.draft.sourceCubes).toEqual(['orders', 'users']);
    expect(result.current.draft.sourceCube).toBe('orders');
  });

  it('setField updates operation', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('operation', 'countDistinct'));
    expect(result.current.draft.operation).toBe('countDistinct');
  });

  it('setField on ofMember also writes the primary slot in inputs', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCubes', ['orders']);
      result.current.setField('ofMember', 'orders.id');
    });
    expect(result.current.draft.ofMember).toBe('orders.id');
    expect(result.current.draft.inputs.value).toBe('orders.id');
  });

  it('setField on ofMemberB writes inputs.denominator', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCubes', ['orders', 'users']);
      result.current.setField('operation', 'ratio');
      result.current.setField('ofMemberB', 'orders.total');
    });
    expect(result.current.draft.ofMemberB).toBe('orders.total');
    expect(result.current.draft.inputs.denominator).toBe('orders.total');
  });

  it('setInput writes a slot and syncs legacy ofMember', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCubes', ['orders']);
      result.current.setInput('value', 'orders.revenue');
    });
    expect(result.current.draft.inputs.value).toBe('orders.revenue');
    expect(result.current.draft.ofMember).toBe('orders.revenue');
  });

  it('toggleSource adds and removes a cube', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.toggleSource('orders'));
    expect(result.current.draft.sourceCubes).toEqual(['orders']);
    act(() => result.current.toggleSource('users'));
    expect(result.current.draft.sourceCubes).toEqual(['orders', 'users']);
    act(() => result.current.toggleSource('orders'));
    expect(result.current.draft.sourceCubes).toEqual(['users']);
  });

  it('setPrimarySource promotes a non-primary selected cube to index 0', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('sourceCubes', ['orders', 'users', 'sessions']));
    act(() => result.current.setPrimarySource('sessions'));
    expect(result.current.draft.sourceCubes).toEqual(['sessions', 'orders', 'users']);
  });

  it('shrinking sources below current op.minSources resets the operation', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCubes', ['orders', 'users']);
      result.current.setField('operation', 'ratio');
      result.current.setInput('numerator', 'orders.revenue');
      result.current.setInput('denominator', 'users.count');
    });
    expect(result.current.draft.operation).toBe('ratio');
    act(() => result.current.setField('sourceCubes', ['orders']));
    expect(result.current.draft.operation).toBe('sum');
    expect(result.current.draft.inputs).toEqual({});
  });

  it('setField updates format', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('format', 'currency'));
    expect(result.current.draft.format).toBe('currency');
  });

  it('setField updates description', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('description', 'A helpful description'));
    expect(result.current.draft.description).toBe('A helpful description');
  });

  it('setField updates filter', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    const filter = { member: 'orders.status', operator: 'equals' as const, values: ['paid'] };
    act(() => result.current.setField('filter', filter));
    expect(result.current.draft.filter).toEqual(filter);
  });

  it('reset returns draft to initial state', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('name', 'active_users');
      result.current.setField('sourceCubes', ['users']);
      result.current.setField('operation', 'avg');
    });
    act(() => result.current.reset());
    expect(result.current.draft.name).toBe('');
    expect(result.current.draft.sourceCubes).toEqual([]);
    expect(result.current.draft.sourceCube).toBeNull();
    expect(result.current.draft.operation).toBe('sum');
  });

  it('exposes isValid=false on fresh draft', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    expect(result.current.isValid).toBe(false);
  });

  it('exposes isValid=true once all required fields are set', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('sourceCubes', ['orders']);
      result.current.setInput('value', 'orders.amount');
      result.current.setField('name', 'total_revenue');
      result.current.setField('title', 'Total Revenue');
    });
    expect(result.current.isValid).toBe(true);
  });

  it('validation object contains per-field errors', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    const { validation } = result.current;
    expect(validation.errors.sourceCubes).toBeDefined();
    expect(validation.errors['inputs.value']).toBeDefined();
    expect(validation.errors.name).toBeDefined();
    expect(validation.errors.title).toBeDefined();
  });

  it('setField updates tags array', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('tags', ['revenue', 'daily']));
    expect(result.current.draft.tags).toEqual(['revenue', 'daily']);
  });

  it('setField updates previewTimeDimension', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('previewTimeDimension', 'orders.created_at'));
    expect(result.current.draft.previewTimeDimension).toBe('orders.created_at');
  });

  it('setField updates previewRange', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('previewRange', '30d'));
    expect(result.current.draft.previewRange).toBe('30d');
  });

  it('reset clears tags and preview fields', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => {
      result.current.setField('tags', ['x']);
      result.current.setField('previewTimeDimension', 'orders.created_at');
      result.current.setField('previewRange', '30d');
    });
    act(() => result.current.reset());
    expect(result.current.draft.tags).toEqual([]);
    expect(result.current.draft.previewTimeDimension).toBeNull();
    expect(result.current.draft.previewRange).toBe('7d');
  });
});

describe('validate() — tags', () => {
  it('accepts an empty tags array', () => {
    expect(validate({ ...VALID_DRAFT, tags: [] }).isValid).toBe(true);
  });

  it('accepts well-formed unique tags', () => {
    const result = validate({ ...VALID_DRAFT, tags: ['revenue', 'daily', 'core'] });
    expect(result.isValid).toBe(true);
  });

  it('rejects whitespace-only tag entries', () => {
    const result = validate({ ...VALID_DRAFT, tags: ['revenue', '   '] });
    expect(result.isValid).toBe(false);
    expect(result.errors.tags).toMatch(/whitespace/i);
  });

  it('rejects case-sensitive duplicate tags', () => {
    const result = validate({ ...VALID_DRAFT, tags: ['revenue', 'revenue'] });
    expect(result.isValid).toBe(false);
    expect(result.errors.tags).toMatch(/duplicate/i);
  });

  it('treats Revenue and revenue as DISTINCT (case-sensitive)', () => {
    const result = validate({ ...VALID_DRAFT, tags: ['Revenue', 'revenue'] });
    expect(result.isValid).toBe(true);
  });
});
