/**
 * yaml-splice.ts
 * Pure function: inserts a new entry (measure / dimension / segment) into a
 * Cube model YAML string. Uses js-yaml for parse/dump to maintain structural
 * correctness.
 *
 * Handles two Cube YAML shapes:
 *   1. `cubes:` array form — `cubes: [ { name: …, measures: […] } ]`
 *      (canonical multi-cube file, what real schemas use)
 *   2. Single-cube flat form — `name: …, measures: […]` at the top level
 *      (Cube also accepts this for one-cube-per-file schemas)
 *
 * NOTE on comments: `js-yaml.dump` does not preserve comments. The whole file
 * is round-tripped through parse → mutate → dump, so any comments in the input
 * YAML are lost. This is a known limitation; switch to a comment-preserving
 * library (e.g. `yaml` v2 with `Document`) if comment retention becomes a hard
 * requirement.
 */

import * as yaml from 'js-yaml';

export type EntryKind = 'measure' | 'dimension' | 'segment';

/** Section key in a cube node that holds entries of each kind. */
const SECTION_KEY: Record<EntryKind, 'measures' | 'dimensions' | 'segments'> = {
  measure: 'measures',
  dimension: 'dimensions',
  segment: 'segments',
};

/** Required top-level patch keys per kind. Dimension also requires exactly
 *  one of `sql` or `case` (banding emits `case`, the other 3 emit `sql`). */
const REQUIRED_KEYS_BY_KIND: Record<EntryKind, ReadonlyArray<string>> = {
  measure: ['name', 'sql', 'type'],
  dimension: ['name', 'type'],
  segment: ['name', 'sql'],
};

/** Reserved Cube top-level keywords that cannot be used as entry names. */
const RESERVED_NAMES = new Set([
  'joins',
  'dimensions',
  'segments',
  'measures',
  'pre_aggregations',
  'sql',
  'extends',
  'data_source',
]);

export interface SpliceResult {
  /** The updated YAML string to write to disk. */
  next: string;
  /** The original YAML string, kept for rollback. */
  prior: string;
}

type CubeNode = Record<string, unknown> & {
  name?: unknown;
  measures?: unknown;
  dimensions?: unknown;
  segments?: unknown;
};

/**
 * Parses `yamlPatch` as a single entry mapping, validates required keys per
 * `kind`, then splices it into `input` under the cube identified by `cubeName`.
 *
 * Throws a descriptive Error on any validation failure; caller should map
 * these to HTTP 400 responses.
 *
 * Kind-aware behavior:
 *   - measure   → splices into `cube.measures[]`, required keys [name, sql, type]
 *   - dimension → splices into `cube.dimensions[]`, requires [name, type] + (sql | case)
 *   - segment   → splices into `cube.segments[]`, required keys [name, sql]
 *
 * Duplicate detection is **per-section** — a measure and a segment may share
 * a name. Cross-kind name collisions are explicitly allowed (UX disambiguates
 * via kind badges).
 *
 * The 4-arg legacy signature `splice(input, cube, name, patch)` defaults
 * `kind = 'measure'` for back-compat with callers that haven't migrated yet.
 */
export function splice(
  input: string,
  cubeName: string,
  entryName: string,
  yamlPatch: string,
  kind: EntryKind = 'measure',
): SpliceResult {
  if (RESERVED_NAMES.has(entryName)) {
    throw new Error(`entryName "${entryName}" is a reserved Cube keyword`);
  }

  // Parse the cube model document.
  const doc = yaml.load(input) as Record<string, unknown>;
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('Cube model YAML must be a mapping at the top level');
  }

  // Parse the patch fragment — must be a single mapping.
  const patch = yaml.load(yamlPatch) as Record<string, unknown>;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new Error('yamlPatch must be a YAML mapping (object), not a scalar or sequence');
  }

  // Validate required patch keys per-kind.
  for (const key of REQUIRED_KEYS_BY_KIND[kind]) {
    if (!(key in patch)) {
      throw new Error(`yamlPatch is missing required key for ${kind}: "${key}"`);
    }
  }
  // Dimension also requires exactly one of `sql` | `case` (banding emits
  // `case`, the other three sub-kinds emit `sql`).
  if (kind === 'dimension' && !('sql' in patch) && !('case' in patch)) {
    throw new Error('yamlPatch for dimension must contain either "sql" or "case"');
  }

  // Ensure the patch name matches the declared entryName.
  if (patch['name'] !== entryName) {
    throw new Error(
      `yamlPatch.name "${String(patch['name'])}" does not match entryName "${entryName}"`,
    );
  }

  // Locate the target cube node within whichever shape the document uses.
  const cube = findCubeNode(doc, cubeName);
  const sectionKey = SECTION_KEY[kind];

  // Normalise the target section to an array.
  const rawSection = (cube as Record<string, unknown>)[sectionKey];
  let entries: Record<string, unknown>[];
  if (rawSection === undefined || rawSection === null) {
    entries = [];
  } else if (Array.isArray(rawSection)) {
    entries = rawSection as Record<string, unknown>[];
  } else {
    throw new Error(`Cube "${cubeName}" "${sectionKey}" key is not a sequence — cannot splice`);
  }

  // Reject **within-kind** duplicate names. Cross-kind same names are allowed
  // (a measure named `whales` and a segment named `whales` coexist).
  const duplicate = entries.find(
    (e) => typeof e === 'object' && e !== null && e['name'] === entryName,
  );
  if (duplicate) {
    throw new Error(`${kind} "${entryName}" already exists in cube "${cubeName}"`);
  }

  // Mutate in place — `cube` is a reference into `doc`, so updating it
  // updates the document.
  (cube as Record<string, unknown>)[sectionKey] = [...entries, patch];

  const next = yaml.dump(doc, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  return { next, prior: input };
}

/**
 * Find the cube definition matching `cubeName`, supporting both YAML shapes.
 *
 * Shape 1 — `cubes:` array form:
 *     cubes:
 *       - name: orders
 *         measures: [...]
 *
 * Shape 2 — single-cube flat form (legacy / one-cube-per-file convention):
 *     name: orders
 *     measures: [...]
 *
 * Throws if neither shape matches or the named cube isn't present.
 */
function findCubeNode(doc: Record<string, unknown>, cubeName: string): CubeNode {
  if (Object.prototype.hasOwnProperty.call(doc, 'cubes')) {
    const cubes = doc['cubes'];
    if (!Array.isArray(cubes)) {
      throw new Error('Top-level "cubes" key must be a sequence');
    }
    const match = cubes.find(
      (c): c is CubeNode =>
        typeof c === 'object' && c !== null && (c as CubeNode).name === cubeName,
    );
    if (!match) {
      const known = cubes
        .map((c) => (typeof c === 'object' && c !== null ? (c as CubeNode).name : null))
        .filter((n): n is string => typeof n === 'string');
      throw new Error(
        `Cube "${cubeName}" not found in cubes[]; available: ${known.join(', ') || '(none)'}`,
      );
    }
    return match;
  }

  // Flat shape — the document itself IS the cube node.
  if (doc['name'] === cubeName) {
    return doc as CubeNode;
  }

  // Some flat-shape files omit `name` and rely on the filename. Accept if
  // there is no `cubes:` key AND no conflicting top-level `name`.
  if (!('name' in doc)) {
    return doc as CubeNode;
  }

  throw new Error(
    `Document top-level name "${String(doc['name'])}" does not match cubeName "${cubeName}", ` +
      `and no "cubes:" array is present`,
  );
}
