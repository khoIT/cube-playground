/** Operators allowed per leaf value type. UI uses these to populate dropdowns. */

import type { LeafOperator, LeafValueType } from '../../../../types/segment-api';

export interface OpDef {
  id: LeafOperator;
  label: string;
  /** Whether this op takes a value field. (set/notSet do not.) */
  takesValue: boolean;
  /** Whether the value field is a list/multi-select. */
  multiValue?: boolean;
}

const STRING_OPS: OpDef[] = [
  { id: 'equals',    label: 'equals',     takesValue: true },
  { id: 'notEquals', label: 'not equals', takesValue: true },
  { id: 'contains',  label: 'contains',   takesValue: true },
  { id: 'in',        label: 'in',         takesValue: true, multiValue: true },
  { id: 'notIn',     label: 'not in',     takesValue: true, multiValue: true },
  { id: 'set',       label: 'is set',     takesValue: false },
  { id: 'notSet',    label: 'is not set', takesValue: false },
];

const NUMBER_OPS: OpDef[] = [
  { id: 'equals',    label: 'equals',        takesValue: true },
  { id: 'notEquals', label: 'not equals',    takesValue: true },
  { id: 'gt',        label: '>',             takesValue: true },
  { id: 'gte',       label: '≥',        takesValue: true },
  { id: 'lt',        label: '<',             takesValue: true },
  { id: 'lte',       label: '≤',        takesValue: true },
  { id: 'set',       label: 'is set',        takesValue: false },
  { id: 'notSet',    label: 'is not set',    takesValue: false },
];

const TIME_OPS: OpDef[] = [
  { id: 'inDateRange', label: 'in date range', takesValue: true, multiValue: true },
  { id: 'beforeDate',  label: 'before',        takesValue: true },
  { id: 'afterDate',   label: 'after',         takesValue: true },
  { id: 'set',         label: 'is set',        takesValue: false },
  { id: 'notSet',      label: 'is not set',    takesValue: false },
];

const BOOLEAN_OPS: OpDef[] = [
  { id: 'equals',    label: 'equals',     takesValue: true },
  { id: 'notEquals', label: 'not equals', takesValue: true },
];

export const OP_BY_TYPE: Record<LeafValueType, OpDef[]> = {
  string: STRING_OPS,
  number: NUMBER_OPS,
  time: TIME_OPS,
  boolean: BOOLEAN_OPS,
};

export function operatorsFor(type: LeafValueType): OpDef[] {
  return OP_BY_TYPE[type] ?? STRING_OPS;
}

export function opDef(type: LeafValueType, op: LeafOperator): OpDef | undefined {
  return operatorsFor(type).find((o) => o.id === op);
}
