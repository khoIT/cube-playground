/**
 * Inline positional `?` parameters into a Cube-generated SQL string so the
 * result is directly runnable in a SQL editor (Trino/Presto/etc.) with no
 * separate parameter binding.
 *
 * Cube emits generated SQL as a prepared statement: the SQL text keeps `?`
 * placeholders and the literal values are returned separately —
 * `sqlQuery.rawQuery().sql` is the tuple `[sqlText, params]`. The SQL tabs
 * historically rendered only `sqlQuery.sql()` (the placeholder form), which
 * fails when pasted into a SQL editor: "Incorrect number of parameters:
 * expected N but found 0". This substitutes each placeholder with its value as
 * a SQL literal, matching the positional binding the DB engine would perform.
 */
export function inlineSqlParams(sql: string, params: readonly unknown[] = []): string {
  if (!params.length) return sql;
  let i = 0;
  // `?` does not occur in Cube-generated SQL except as a bind placeholder, so a
  // left-to-right sequential replace mirrors positional parameter binding.
  return sql.replace(/\?/g, () => (i < params.length ? toSqlLiteral(params[i++]) : '?'));
}

/** Render a single bound value as a SQL literal. */
function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  // Strings (timestamps, ids, filter values) — escape embedded single quotes.
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Resolve `[sqlText, params]` from a cube-client `SqlQuery` instance and return
 * the runnable, inlined SQL. Falls back to the placeholder form if the raw
 * tuple shape is unavailable.
 */
export function runnableSqlFromSqlQuery(sqlQuery: {
  rawQuery?: () => { sql?: [string, unknown[]] } | undefined;
  sql?: () => string;
}): string | undefined {
  const rawSql = sqlQuery?.rawQuery?.()?.sql;
  if (Array.isArray(rawSql)) {
    const [sqlText, params = []] = rawSql;
    return sqlText ? inlineSqlParams(sqlText, params) : undefined;
  }
  return sqlQuery?.sql?.();
}
