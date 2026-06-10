/**
 * Inline Cube's parameterized SQL into a standalone statement.
 *
 * Cube `/sql` returns `[sqlText, params]` where sqlText carries positional `?`
 * placeholders (Trino dialect) and params is the ordered value list. The
 * lakehouse writer wraps this SELECT inside an INSERT, so the placeholders must
 * be inlined as literals — there is no prepared-statement path through the
 * Trino REST transport.
 *
 * The scanner is quote-aware: it replaces only `?` that sit OUTSIDE single- or
 * double-quoted string literals, so a literal containing `?` is never mistaken
 * for a placeholder. Values are typed-quoted (numbers raw, strings escaped,
 * booleans/null as keywords). Inputs originate from our own stored segment
 * predicates (internal), but quoting is still done correctly to avoid breaking
 * on apostrophes and to stay injection-safe by construction.
 */

/** Render a single param value as a Trino SQL literal. */
export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot inline non-finite number param: ${value}`);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'bigint') return value.toString();
  // Everything else (string, date string Cube already stringified, etc.) →
  // single-quoted, with embedded single quotes doubled per SQL standard.
  const s = String(value);
  return `'${s.split("'").join("''")}'`;
}

/**
 * Replace each positional `?` placeholder in `sqlText` with the typed literal
 * of the corresponding param. Throws when the placeholder count and param
 * count disagree — a mismatch means a wrong inlining and must fail loudly
 * rather than emit malformed SQL.
 */
export function inlineSqlParams(sqlText: string, params: readonly unknown[]): string {
  let out = '';
  let paramIdx = 0;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];

    if (quote) {
      out += ch;
      if (ch === quote) {
        // A doubled quote ('') is an escaped quote inside the literal, not a
        // close — consume the second one and stay in-string.
        if (sqlText[i + 1] === quote) {
          out += sqlText[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '?') {
      if (paramIdx >= params.length) {
        throw new Error(
          `inlineSqlParams: more '?' placeholders than params (${params.length})`,
        );
      }
      out += toSqlLiteral(params[paramIdx]);
      paramIdx++;
      continue;
    }

    out += ch;
  }

  if (quote) {
    throw new Error('inlineSqlParams: unterminated string literal in SQL');
  }
  if (paramIdx !== params.length) {
    throw new Error(
      `inlineSqlParams: ${params.length} params but only ${paramIdx} '?' placeholders consumed`,
    );
  }
  return out;
}
