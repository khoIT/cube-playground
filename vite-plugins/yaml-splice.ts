/**
 * yaml-splice.ts
 * Pure function: inserts a new measure entry into a Cube model YAML string.
 * Uses js-yaml for parse/dump to maintain structural correctness.
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

/** Required top-level keys every measure patch must contain. */
const REQUIRED_PATCH_KEYS = ['name', 'sql', 'type'] as const;

/** Reserved Cube top-level keywords that cannot be used as measure names. */
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
};

/**
 * Parses `yamlPatch` as a single measure mapping, validates required keys,
 * then splices it into `input` under the cube identified by `cubeName`.
 *
 * Throws a descriptive Error on any validation failure; caller should map
 * these to HTTP 400 responses.
 */
export function splice(
  input: string,
  cubeName: string,
  measureName: string,
  yamlPatch: string,
): SpliceResult {
  if (RESERVED_NAMES.has(measureName)) {
    throw new Error(`measureName "${measureName}" is a reserved Cube keyword`);
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

  // Validate required patch keys.
  for (const key of REQUIRED_PATCH_KEYS) {
    if (!(key in patch)) {
      throw new Error(`yamlPatch is missing required key: "${key}"`);
    }
  }

  // Ensure the patch name matches the declared measureName.
  if (patch['name'] !== measureName) {
    throw new Error(
      `yamlPatch.name "${String(patch['name'])}" does not match measureName "${measureName}"`,
    );
  }

  // Locate the target cube node within whichever shape the document uses.
  const cube = findCubeNode(doc, cubeName);

  // Normalise measures section to an array.
  const rawMeasures = cube.measures;
  let measures: Record<string, unknown>[];
  if (rawMeasures === undefined || rawMeasures === null) {
    measures = [];
  } else if (Array.isArray(rawMeasures)) {
    measures = rawMeasures as Record<string, unknown>[];
  } else {
    throw new Error(`Cube "${cubeName}" "measures" key is not a sequence — cannot splice`);
  }

  // Reject duplicate measure names (collision guard).
  const duplicate = measures.find(
    (m) => typeof m === 'object' && m !== null && m['name'] === measureName,
  );
  if (duplicate) {
    throw new Error(`Measure "${measureName}" already exists in cube "${cubeName}"`);
  }

  // Mutate in place — `cube` is a reference into `doc`, so updating it
  // updates the document. Spread of `cube` is intentional to preserve key
  // order around the (possibly new) `measures:` entry.
  cube.measures = [...measures, patch];

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
