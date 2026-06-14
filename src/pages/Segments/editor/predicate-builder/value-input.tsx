/** Renders the correct value editor for a leaf based on (type, op). */

import { ReactElement } from 'react';
import { AutoComplete, Input, InputNumber, Select, Switch } from 'antd';
import { opDef } from './operators';
import { useDimValueSuggestions } from './use-dim-value-suggestions';
import type {
  LeafOperator,
  LeafValueType,
  PercentileValue,
  RelativeDateValue,
} from '../../../../types/segment-api';

interface Props {
  type: LeafValueType;
  op: LeafOperator;
  values: unknown[];
  onChange: (values: unknown[]) => void;
  /** Fully-qualified member name (e.g. mf_users.os_platform) for value suggestions. */
  member?: string;
}

export function ValueInput({ type, op, values, onChange, member }: Props): ReactElement | null {
  const def = opDef(type, op);
  const { fetchSuggestions, suggestions } = useDimValueSuggestions(member ?? null, type, op);

  if (!def || !def.takesValue) return null;

  // Statistical: percentile cutoff over a reference population. Stored as a single
  // structured value { p, over } so the compiler runs the two-pass resolve.
  if (op === 'percentileGte' || op === 'percentileLte') {
    const pv = (values[0] ?? {}) as Partial<PercentileValue>;
    const p = typeof pv.p === 'number' ? pv.p : 25;
    const update = (next: Partial<PercentileValue>): void =>
      onChange([{ p, over: pv.over, ...next }]);
    return (
      <div style={{ display: 'flex', gap: 8, width: '100%', minWidth: 240 }}>
        <InputNumber
          min={1}
          max={99}
          value={p}
          onChange={(v) => update({ p: typeof v === 'number' ? v : 25 })}
          formatter={(v) => `${v}%`}
          parser={(v) => Number((v ?? '').replace('%', ''))}
          style={{ width: 110 }}
        />
        <Input
          value={pv.over?.table ?? ''}
          onChange={(e) => update({ over: { ...pv.over, table: e.target.value } })}
          placeholder="over population (table)"
        />
      </div>
    );
  }

  // Derived relative-date: { n, unit } resolved to an absolute bound at compile time.
  if (op === 'dateWithinLast' || op === 'dateBeforeLast') {
    const rv = (values[0] ?? {}) as Partial<RelativeDateValue>;
    const n = typeof rv.n === 'number' ? rv.n : 6;
    const unit = rv.unit ?? 'month';
    const update = (next: Partial<RelativeDateValue>): void =>
      onChange([{ n, unit, ...next }]);
    return (
      <div style={{ display: 'flex', gap: 8, width: '100%', minWidth: 200 }}>
        <InputNumber
          min={1}
          value={n}
          onChange={(v) => update({ n: typeof v === 'number' ? v : 1 })}
          style={{ width: 100 }}
        />
        <Select
          value={unit}
          onChange={(u: RelativeDateValue['unit']) => update({ unit: u })}
          options={[
            { value: 'day', label: 'days' },
            { value: 'week', label: 'weeks' },
            { value: 'month', label: 'months' },
          ]}
          style={{ width: 110 }}
        />
      </div>
    );
  }

  if (def.multiValue) {
    const isDateRange = type === 'time' && op === 'inDateRange';
    return (
      <Select
        mode="tags"
        style={{ width: '100%', minWidth: 240 }}
        value={values.map(String)}
        onChange={(v) => onChange(v)}
        placeholder={
          isDateRange
            ? 'Two YYYY-MM-DD dates (or a range like "this month")'
            : 'Press enter to add'
        }
      />
    );
  }

  if (type === 'number') {
    return (
      <InputNumber
        value={typeof values[0] === 'number' ? values[0] : Number(values[0] ?? 0)}
        onChange={(v) => onChange([v ?? 0])}
        style={{ width: '100%', minWidth: 140 }}
      />
    );
  }

  if (type === 'boolean') {
    return (
      <Switch
        checked={values[0] === true || values[0] === 'true'}
        onChange={(v) => onChange([v])}
      />
    );
  }

  // String dims with equality ops: AutoComplete with fetched suggestions.
  // Free-text entry is always allowed — suggestions are advisory only.
  if (type === 'string' && suggestions.length > 0) {
    return (
      <AutoComplete
        value={String(values[0] ?? '')}
        options={suggestions.map((s) => ({ value: s }))}
        onSelect={(v: string) => onChange([v])}
        onChange={(v: string) => onChange([v])}
        onFocus={fetchSuggestions}
        style={{ width: '100%', minWidth: 200 }}
        placeholder="value"
        filterOption={(input, option) =>
          (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
        }
      />
    );
  }

  // String dim without suggestions yet, or time dim — plain text input.
  // For string, trigger suggestion fetch on focus so options populate lazily.
  return (
    <Input
      value={String(values[0] ?? '')}
      onChange={(e) => onChange([e.target.value])}
      onFocus={type === 'string' ? fetchSuggestions : undefined}
      style={{ width: '100%', minWidth: 200 }}
      placeholder={type === 'time' ? 'YYYY-MM-DD' : 'value'}
    />
  );
}
