/**
 * Read + parse every per-game dev Cube YAML and its prod-clone oracle
 * counterpart, then reduce each cube to a comparable "shape" the rules and
 * oracle-diff modules can reason over without re-parsing YAML.
 *
 * Dev cubes use bare names (`recharge`); oracle cubes are prefixed with the
 * Trino schema (`cfm_vn__recharge`). The logical entity name — the bare name
 * with the schema prefix stripped — is the pairing key across the two trees.
 *
 * Oracle availability is determined at runtime per (game, cube): a populated
 * oracle directory makes a game oracle-backed; a dev cube with no matching
 * oracle entity is simply "no counterpart" (not an error).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { GAME_SCHEMA } from '../canonical-cube-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/lib/cube-parity → cube-dev → cube/model/cubes
const DEV_CUBES_DIR = join(__dirname, '..', '..', '..', 'cube', 'model', 'cubes');
// Default prod-clone location (confirmed: a checkout of kraken/cube).
const PROD_ROOT_DEFAULT = '/Users/lap16299/Documents/code/cube-prod';

/** Dev games = the per-game directories that actually exist under cube/model/cubes. */
export function discoverDevGames() {
  return readdirSync(DEV_CUBES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
}

/** Strip a leading `${schema}__` so oracle and dev cubes share one logical key. */
export function logicalName(cubeName, schema) {
  const prefix = `${schema}__`;
  return cubeName.startsWith(prefix) ? cubeName.slice(prefix.length) : cubeName;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/** First 1-based line in `rawLines` matching `needle`, or null. */
function lineOf(rawLines, needle) {
  const idx = rawLines.findIndex((l) => l.includes(needle));
  return idx === -1 ? null : idx + 1;
}

/**
 * Reduce a parsed cube object into the comparable shape. `rawLines` is the
 * file split on newlines, used for best-effort line attribution of findings.
 */
function normalizeCube(cube, ctx) {
  const { game, schema, file, absFile, side, rawLines } = ctx;
  const name = cube.name ?? '(unnamed)';
  const dims = asArray(cube.dimensions).map((d) => ({
    name: d.name,
    type: d.type,
    sql: d.sql ?? (d.case ? '(case)' : undefined),
    primaryKey: d.primary_key === true,
    line: lineOf(rawLines, `name: ${d.name}`),
  }));
  const measures = asArray(cube.measures).map((m) => ({
    name: m.name,
    type: m.type,
    sql: m.sql,
    line: lineOf(rawLines, `name: ${m.name}`),
  }));
  const joins = asArray(cube.joins).map((j) => ({
    name: j.name,
    relationship: j.relationship,
    sql: j.sql,
    line: lineOf(rawLines, `name: ${j.name}`),
  }));
  const preAggs = asArray(cube.pre_aggregations).map((p) => ({
    name: p.name,
    type: p.type ?? 'rollup',
    measures: asArray(p.measures),
    dimensions: asArray(p.dimensions),
    timeDimension: p.time_dimension ?? null,
    granularity: p.granularity ?? null,
    line: lineOf(rawLines, `name: ${p.name}`),
  }));
  return {
    game,
    schema,
    side,
    file,
    absFile,
    cubeName: name,
    logical: logicalName(name, schema),
    sqlTable: cube.sql_table ?? null,
    hasInlineSql: typeof cube.sql === 'string',
    primaryKeys: dims.filter((d) => d.primaryKey).map((d) => d.name),
    dimensions: dims,
    measures,
    joins,
    preAggs,
    segments: asArray(cube.segments).map((s) => s.name),
    nameLine: lineOf(rawLines, `name: ${name}`),
  };
}

/** Parse one YAML file (which may declare several cubes) into shapes. */
function loadFile(absPath, relPath, game, schema, side) {
  const text = readFileSync(absPath, 'utf8');
  const rawLines = text.split('\n');
  let doc;
  try {
    doc = yaml.load(text);
  } catch (err) {
    return { cubes: [], parseError: { file: relPath, message: String(err.message ?? err) } };
  }
  const cubes = asArray(doc?.cubes).map((c) =>
    normalizeCube(c, { game, schema, side, file: relPath, absFile: absPath, rawLines }),
  );
  return { cubes, parseError: null };
}

/** Load every cube shape under a directory of `*.yml` files. */
function loadDir(dir, game, schema, relPrefix, side) {
  if (!existsSync(dir)) return { cubes: [], parseErrors: [] };
  const cubes = [];
  const parseErrors = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.yml')).sort()) {
    const { cubes: cs, parseError } = loadFile(join(dir, f), `${relPrefix}/${f}`, game, schema, side);
    cubes.push(...cs);
    if (parseError) parseErrors.push(parseError);
  }
  return { cubes, parseErrors };
}

/**
 * Load the full model for every dev game alongside its oracle counterpart.
 * Returns { games: [{ game, schema, oracleAvailable, dev[], oracle[], parseErrors[] }] }.
 */
export function loadModel({ prodRoot = PROD_ROOT_DEFAULT } = {}) {
  const prodCubes = join(prodRoot, 'cube', 'model', 'cubes');
  const games = discoverDevGames().map((game) => {
    const schema = GAME_SCHEMA[game] ?? game;
    const dev = loadDir(join(DEV_CUBES_DIR, game), game, schema, `dev/${game}`, 'dev');
    const oracleDir = join(prodCubes, schema);
    const oracle = loadDir(oracleDir, game, schema, `oracle/${schema}`, 'prod');
    return {
      game,
      schema,
      oracleAvailable: oracle.cubes.length > 0,
      dev: dev.cubes,
      oracle: oracle.cubes,
      parseErrors: [...dev.parseErrors, ...oracle.parseErrors],
    };
  });
  return { games, prodRoot };
}

export { PROD_ROOT_DEFAULT };
