import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNewMetricDraft, validate } from '../use-new-metric-draft';
import { NewMetricDraft } from '../../types';

// A fully valid draft for use as a baseline in validation tests
const VALID_DRAFT: NewMetricDraft = {
  sourceCube: 'orders',
  operation: 'sum',
  ofMember: 'orders.amount',
  ofMemberB: null,
  filter: null,
  name: 'total_revenue',
  title: 'Total Revenue',
  description: '',
  format: 'number',
};

// ─── validate() unit tests ────────────────────────────────────────────────────

describe('validate()', () => {
  it('returns isValid=true for a fully valid draft', () => {
    expect(validate(VALID_DRAFT).isValid).toBe(true);
  });

  it('errors when sourceCube is null', () => {
    const result = validate({ ...VALID_DRAFT, sourceCube: null });
    expect(result.isValid).toBe(false);
    expect(result.errors.sourceCube).toBeDefined();
  });

  it('errors when ofMember is null', () => {
    const result = validate({ ...VALID_DRAFT, ofMember: null });
    expect(result.isValid).toBe(false);
    expect(result.errors.ofMember).toBeDefined();
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

  it('errors when operation is ratio and ofMemberB is null', () => {
    const result = validate({ ...VALID_DRAFT, operation: 'ratio', ofMemberB: null });
    expect(result.isValid).toBe(false);
    expect(result.errors.ofMemberB).toBeDefined();
  });

  it('accepts ratio when both ofMember and ofMemberB are set', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'ratio',
      ofMember: 'orders.revenue',
      ofMemberB: 'orders.count',
    });
    expect(result.isValid).toBe(true);
  });

  it('does NOT require ofMemberB for non-ratio operations', () => {
    const ops = ['sum', 'count', 'countDistinct', 'avg', 'min', 'max'] as const;
    ops.forEach((op) => {
      const result = validate({ ...VALID_DRAFT, operation: op, ofMemberB: null });
      expect(result.errors.ofMemberB).toBeUndefined();
    });
  });

  // ─── Cross-cube ratio guard ─────────────────────────────────────────────────

  it('errors on ofMember when ratio operand belongs to a different cube', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'ratio',
      sourceCube: 'orders',
      ofMember: 'users.count',    // cross-cube — belongs to "users", not "orders"
      ofMemberB: 'orders.amount',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.ofMember).toMatch(/cross-cube ratio is not supported/i);
    expect(result.errors.ofMemberB).toBeUndefined();
  });

  it('errors on ofMemberB when denominator belongs to a different cube', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'ratio',
      sourceCube: 'orders',
      ofMember: 'orders.revenue',
      ofMemberB: 'products.cost',  // cross-cube — belongs to "products", not "orders"
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.ofMemberB).toMatch(/cross-cube ratio is not supported/i);
    expect(result.errors.ofMember).toBeUndefined();
  });

  it('accepts ratio when both operands belong to the source cube', () => {
    const result = validate({
      ...VALID_DRAFT,
      operation: 'ratio',
      sourceCube: 'orders',
      ofMember: 'orders.revenue',
      ofMemberB: 'orders.count',
    });
    expect(result.isValid).toBe(true);
    expect(result.errors.ofMember).toBeUndefined();
    expect(result.errors.ofMemberB).toBeUndefined();
  });

  it('accumulates multiple errors at once', () => {
    const result = validate({
      ...VALID_DRAFT,
      sourceCube: null,
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
    expect(result.current.draft.sourceCube).toBeNull();
    expect(result.current.draft.operation).toBe('sum');
    expect(result.current.draft.name).toBe('');
    expect(result.current.draft.format).toBe('number');
  });

  it('setField updates a string field', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('name', 'my_metric'));
    expect(result.current.draft.name).toBe('my_metric');
  });

  it('setField updates sourceCube', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('sourceCube', 'orders'));
    expect(result.current.draft.sourceCube).toBe('orders');
  });

  it('setField updates operation', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('operation', 'countDistinct'));
    expect(result.current.draft.operation).toBe('countDistinct');
  });

  it('setField updates ofMember', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('ofMember', 'orders.id'));
    expect(result.current.draft.ofMember).toBe('orders.id');
  });

  it('setField updates ofMemberB', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    act(() => result.current.setField('ofMemberB', 'orders.total'));
    expect(result.current.draft.ofMemberB).toBe('orders.total');
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
      result.current.setField('sourceCube', 'users');
      result.current.setField('operation', 'avg');
    });
    act(() => result.current.reset());
    expect(result.current.draft.name).toBe('');
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
      result.current.setField('sourceCube', 'orders');
      result.current.setField('ofMember', 'orders.amount');
      result.current.setField('name', 'total_revenue');
      result.current.setField('title', 'Total Revenue');
    });
    expect(result.current.isValid).toBe(true);
  });

  it('validation object contains per-field errors', () => {
    const { result } = renderHook(() => useNewMetricDraft());
    const { validation } = result.current;
    expect(validation.errors.sourceCube).toBeDefined();
    expect(validation.errors.ofMember).toBeDefined();
    expect(validation.errors.name).toBeDefined();
    expect(validation.errors.title).toBeDefined();
  });
});
