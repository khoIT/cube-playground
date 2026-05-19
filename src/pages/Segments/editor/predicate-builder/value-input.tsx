/** Renders the correct value editor for a leaf based on (type, op). */

import { ReactElement } from 'react';
import { Input, InputNumber, Select, Switch } from 'antd';
import { opDef } from './operators';
import type { LeafOperator, LeafValueType } from '../../../../types/segment-api';

interface Props {
  type: LeafValueType;
  op: LeafOperator;
  values: unknown[];
  onChange: (values: unknown[]) => void;
}

export function ValueInput({ type, op, values, onChange }: Props): ReactElement | null {
  const def = opDef(type, op);
  if (!def || !def.takesValue) return null;

  if (def.multiValue) {
    return (
      <Select
        mode="tags"
        style={{ minWidth: 200 }}
        value={values.map(String)}
        onChange={(v) => onChange(v)}
        placeholder="Press enter to add"
      />
    );
  }

  if (type === 'number') {
    return (
      <InputNumber
        value={typeof values[0] === 'number' ? values[0] : Number(values[0] ?? 0)}
        onChange={(v) => onChange([v ?? 0])}
        style={{ minWidth: 140 }}
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

  // string / time fall back to a text input (time can be ISO yyyy-mm-dd)
  return (
    <Input
      value={String(values[0] ?? '')}
      onChange={(e) => onChange([e.target.value])}
      style={{ minWidth: 200 }}
      placeholder={type === 'time' ? 'YYYY-MM-DD' : 'value'}
    />
  );
}
