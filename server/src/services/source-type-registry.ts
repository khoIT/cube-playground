/**
 * Source-type registry — the single source of truth for every connector source
 * type: its connection FIELD SCHEMA (drives the UI form + server validation),
 * its Cube DRIVER type, and its CAPABILITY flags (can we introspect? can cubes
 * join within it? can it participate in a cross-source rollupJoin?).
 *
 * One declaration feeds three consumers: the dynamic connect form (Phase 12),
 * server-side validation (here), and profiler dispatch (Phase 11). Adding a new
 * source type = adding an entry here, nothing else.
 *
 * Field whose `secret: true` holds the credential sealed by the vault; every
 * other field is non-secret connection config. SQL-over-host sources align
 * their field keys to the canonical Connector shape (host/port/user/catalog/ssl)
 * so the existing Trino path and the store reconstruction keep working.
 */

export type FieldType = 'text' | 'password' | 'number' | 'boolean' | 'select' | 'file';

export interface SourceField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Marks the one field sealed into the secret vault (never stored in config). */
  secret?: boolean;
  placeholder?: string;
  default?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
  help?: string;
}

export interface SourceCaps {
  /** Can we list + profile its tables (drives the modeling flow)? */
  introspect: boolean;
  /** Can cubes within this source join via SQL? */
  sameSourceJoins: boolean;
  /** Can it back a cross-source rollupJoin (pre-agg)? Advisory for Phase 15. */
  crossSourceRollupJoin: boolean;
}

export interface SourceType {
  id: string;
  label: string;
  category: 'warehouse' | 'mmp' | 'adnetworks' | 'others';
  /** Cube driver type string used when registering the dataSource. */
  driverType: string;
  fields: SourceField[];
  caps: SourceCaps;
}

const HOST_FIELD: SourceField = { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'warehouse.internal' };
const USER_FIELD: SourceField = { key: 'user', label: 'User', type: 'text', required: true, placeholder: 'svc_playground' };
const SECRET_FIELD: SourceField = { key: 'password', label: 'Password / key', type: 'password', required: false, secret: true, placeholder: '••••••••' };
const SSL_FIELD: SourceField = { key: 'ssl', label: 'Use SSL', type: 'boolean', required: false, default: true };

/** SQL-over-host family shares a field shape; only port default + driver differ. */
function sqlHostSource(
  id: string,
  label: string,
  driverType: string,
  port: number,
): SourceType {
  return {
    id,
    label,
    category: 'warehouse',
    driverType,
    fields: [
      HOST_FIELD,
      { key: 'port', label: 'Port', type: 'number', required: false, default: port },
      { key: 'catalog', label: 'Database / catalog', type: 'text', required: true, placeholder: 'analytics' },
      USER_FIELD,
      SECRET_FIELD,
      SSL_FIELD,
    ],
    caps: { introspect: true, sameSourceJoins: true, crossSourceRollupJoin: true },
  };
}

export const SOURCE_TYPES: SourceType[] = [
  // Trino keeps the canonical shape (catalog labelled accordingly).
  {
    id: 'trino',
    label: 'Trino / Presto',
    category: 'warehouse',
    driverType: 'trino',
    fields: [
      HOST_FIELD,
      { key: 'port', label: 'Port', type: 'number', required: false, default: 443 },
      { key: 'catalog', label: 'Catalog', type: 'text', required: true, placeholder: 'game_integration' },
      USER_FIELD,
      SECRET_FIELD,
      SSL_FIELD,
    ],
    caps: { introspect: true, sameSourceJoins: true, crossSourceRollupJoin: true },
  },
  sqlHostSource('postgres', 'PostgreSQL', 'postgres', 5432),
  sqlHostSource('mysql', 'MySQL', 'mysql', 3306),
  sqlHostSource('redshift', 'Redshift', 'redshift', 5439),
  sqlHostSource('clickhouse', 'ClickHouse', 'clickhouse', 8443),
  // Snowflake / BigQuery don't fit host/port; introspection support lands with
  // their per-type profilers (Phase 11). Fields capture what the driver needs.
  {
    id: 'snowflake',
    label: 'Snowflake',
    category: 'warehouse',
    driverType: 'snowflake',
    fields: [
      { key: 'account', label: 'Account', type: 'text', required: true, placeholder: 'xy12345.eu-west-1' },
      { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'COMPUTE_WH' },
      { key: 'catalog', label: 'Database', type: 'text', required: true, placeholder: 'ANALYTICS' },
      USER_FIELD,
      SECRET_FIELD,
    ],
    caps: { introspect: true, sameSourceJoins: true, crossSourceRollupJoin: true },
  },
  {
    id: 'bigquery',
    label: 'BigQuery',
    category: 'warehouse',
    driverType: 'bigquery',
    fields: [
      { key: 'projectId', label: 'Project ID', type: 'text', required: true, placeholder: 'my-gcp-project' },
      { key: 'catalog', label: 'Dataset', type: 'text', required: true, placeholder: 'analytics' },
      { key: 'keyJson', label: 'Service-account JSON', type: 'file', required: true, secret: true, help: 'Uploaded once, sealed server-side.' },
    ],
    caps: { introspect: true, sameSourceJoins: true, crossSourceRollupJoin: true },
  },
];

export function getSourceType(id: string): SourceType | null {
  return SOURCE_TYPES.find((s) => s.id === id) ?? null;
}

export function listSourceTypes(): SourceType[] {
  return SOURCE_TYPES;
}

export interface ValidatedConnection {
  ok: boolean;
  errors: string[];
  /** Non-secret coordinates, keyed by field. Empty when invalid. */
  config: Record<string, unknown>;
  /** The sealed-field value (may be '' if the secret field is optional/blank). */
  secret: string;
  driverType: string;
}

/**
 * Validate raw form input against a source type, coercing typed fields and
 * splitting the secret field out of the config. Unknown source type or a missing
 * required field yields `ok:false` with messages.
 */
export function validateConnectionInput(
  sourceTypeId: string,
  input: Record<string, unknown>,
): ValidatedConnection {
  const st = getSourceType(sourceTypeId);
  if (!st) {
    return { ok: false, errors: [`unknown source type: ${sourceTypeId}`], config: {}, secret: '', driverType: '' };
  }
  const errors: string[] = [];
  const config: Record<string, unknown> = {};
  let secret = '';

  for (const f of st.fields) {
    const raw = input[f.key];
    const present = raw !== undefined && raw !== null && raw !== '';
    if (f.required && !present) {
      errors.push(`${f.label} is required`);
      continue;
    }
    const value = coerce(raw, f, present);
    if (f.secret) {
      secret = present ? String(raw) : '';
    } else if (present || f.default !== undefined) {
      config[f.key] = value;
    }
  }

  return { ok: errors.length === 0, errors, config: errors.length ? {} : config, secret, driverType: st.driverType };
}

function coerce(raw: unknown, field: SourceField, present: boolean): unknown {
  if (!present) return field.default;
  switch (field.type) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1 || raw === '1';
    default:
      return String(raw);
  }
}
