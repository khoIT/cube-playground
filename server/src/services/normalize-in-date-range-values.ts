/**
 * Normalize `inDateRange` leaf values to the canonical flat `[start, end]` form.
 *
 * The UI authoring path (segments-save-bar/build-predicate-from-rows.ts) emits
 * `values: [[start, end]]` — a 1-element array wrapping the 2-tuple — because
 * it treats each `values[i]` as one logical value (and a range *is* one value).
 *
 * The Cube and SQL translators expect `values: [start, end]` — a flat 2-tuple.
 *
 * Without normalization, the nested shape collapses to `[\"start,end\"]` after
 * `map(String)`, falls into the "length !== 2" branch, fails to expand as a
 * relative range, and the filter is silently dropped — producing segment
 * counts against the surrounding date window instead of the intended bucket.
 */
export function normalizeInDateRangeValues(values: unknown[]): unknown[] {
  if (
    values.length === 1 &&
    Array.isArray(values[0]) &&
    values[0].length === 2
  ) {
    return values[0] as unknown[];
  }
  return values;
}
