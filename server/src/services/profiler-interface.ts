/**
 * Profiler interface + dispatch. The onboarding pipeline talks to ONE Profiler
 * abstraction; `getProfiler(connector)` picks the implementation by source type:
 *   - trino                       → the Trino REST profiler (reference impl)
 *   - postgres/mysql/redshift/…   → the ANSI information_schema profiler, IF a
 *                                    SQL runner is wired for that driver type
 *   - non-introspectable types    → throws NOT_INTROSPECTABLE
 *   - introspectable but no driver→ throws DRIVER_NOT_WIRED
 *
 * Keeping dispatch here (not in the route) means adding a source type is a
 * registry + runner-factory change, never a route change.
 */

import type { TableMeta, TableProfile } from '../types/raw-schema.js';
import type { Connector } from './trino-profiler-config.js';
import { listTables as trinoListTables, profileTable as trinoProfileTable } from './trino-profiler.js';
import { createInformationSchemaProfiler } from './information-schema-profiler.js';
import { getSourceType } from './source-type-registry.js';

export interface Profiler {
  listTables(connector: Connector, schema: string): Promise<TableMeta[]>;
  profileTable(connector: Connector, schema: string, table: string): Promise<TableProfile>;
}

export type ProfilerUnavailableCode = 'NOT_INTROSPECTABLE' | 'DRIVER_NOT_WIRED';

/** Thrown when a connector's source type can't be profiled in this build. */
export class ProfilerUnavailableError extends Error {
  readonly code: ProfilerUnavailableCode;
  constructor(code: ProfilerUnavailableCode, message: string) {
    super(message);
    this.name = 'ProfilerUnavailableError';
    this.code = code;
  }
}

const trinoProfiler: Profiler = {
  listTables: trinoListTables,
  profileTable: trinoProfileTable,
};

/** Resolve the Profiler for a connector. Throws ProfilerUnavailableError if none. */
export function getProfiler(connector: Connector): Profiler {
  const type = connector.sourceType || 'trino';
  if (type === 'trino') return trinoProfiler;

  const st = getSourceType(type);
  if (!st?.caps.introspect) {
    throw new ProfilerUnavailableError(
      'NOT_INTROSPECTABLE',
      `source type "${type}" does not support schema introspection yet`,
    );
  }
  const profiler = createInformationSchemaProfiler(connector);
  if (!profiler) {
    throw new ProfilerUnavailableError(
      'DRIVER_NOT_WIRED',
      `introspection driver for "${type}" is not wired in this build`,
    );
  }
  return profiler;
}
