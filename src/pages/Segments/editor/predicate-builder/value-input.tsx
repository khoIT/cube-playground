/** Renders the correct value editor for a leaf based on (type, op). */

import { ReactElement } from 'react';
import { AutoComplete, Input, InputNumber, Select, Switch } from 'antd';
import { opDef } from './operators';
import { useDimValueSuggestions } from './use-dim-value-suggestions';
import type { LeafOperator, LeafValueType } from '../../../../types/segment-api';

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
