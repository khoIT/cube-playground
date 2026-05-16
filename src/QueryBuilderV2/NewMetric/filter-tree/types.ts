// Column types we recognise for value-quoting. Anything else throws from flatten.
export type ColumnType = 'string' | 'number' | 'integer' | 'boolean' | 'time' | 'date';

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'IN'
  | 'NOT IN'
  | 'contains'
  | 'startsWith'
  | 'set'
  | 'notSet';

export type FilterLeaf = {
  kind: 'leaf';
  id: string;
  column: string;
  columnType: ColumnType;
  op: FilterOperator;
  values: string[];
};

export type FilterGroup = {
  kind: 'group';
  id: string;
  op: 'AND' | 'OR';
  children: FilterNode[];
};

export type FilterNode = FilterLeaf | FilterGroup;

export type ColumnTypeMap = Record<string, ColumnType>;
