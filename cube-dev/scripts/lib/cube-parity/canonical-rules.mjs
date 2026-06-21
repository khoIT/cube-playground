/**
 * Internal-consistency rules applied to EVERY dev cube, oracle or not. These
 * catch the documented recurring bug shapes without needing a reference model:
 *   - dangling measure refs (sql references a {measure} that does not exist)
 *   - non-additive measures inside a rollup pre-aggregation
 *   - rollup time-dimension / granularity declared inconsistently
 *   - missing primary key on a cube other cubes join to
 *   - integer-division ratio with no double cast (silent truncation risk)
 *   - identity-bridge joins (split_part(... '@' ...)) — tagged, not faulted
 *
 * Severity rubric: correctness > parity > cosmetic. A finding records a stable
 * root_cause_key WITHOUT the game token so the same canonical-cube bug across
 * games collapses to one row in triage.
 */

const ADDITIVE_MEASURE_TYPES = new Set([
  'count',
  'sum',
  'min',
  'max',
  // count_distinct_approx is HLL-sketch additive in CubeStore; plain
  // count_distinct and calculated number measures are NOT.
  'count_distinct_approx',
]);

// A measure reference is `{name}` NOT followed by a dot. `{CUBE}.col` and
// `{cubeName}.col` are column references (valid Cube syntax), not measure refs,
// so the negative lookahead avoids flagging them as dangling.
const MEASURE_REF = /\{(\w+)\}(?!\.)/g;

function finding(cube, partial) {
  return {
    game: cube.game,
    cube: cube.logical,
    cubeName: cube.cubeName,
    file: cube.file,
    verdict: null,
    ...partial,
  };
}

/** Names of measures defined on the cube. */
function measureNames(cube) {
  return new Set(cube.measures.map((m) => m.name));
}

/** {refs} inside a measure sql that are not {CUBE} and not a dimension. */
function refsIn(sql) {
  if (typeof sql !== 'string') return [];
  const out = [];
  let m;
  MEASURE_REF.lastIndex = 0;
  while ((m = MEASURE_REF.exec(sql))) {
    if (m[1] !== 'CUBE') out.push(m[1]);
  }
  return out;
}

function checkDanglingRefs(cube, findings) {
  const measures = measureNames(cube);
  const dims = new Set(cube.dimensions.map((d) => d.name));
  for (const m of cube.measures) {
    for (const ref of refsIn(m.sql)) {
      if (!measures.has(ref) && !dims.has(ref)) {
        findings.push(
          finding(cube, {
            dimension: 'measure',
            severity: 'correctness',
            line: m.line,
            devValue: `${m.name}.sql references {${ref}}`,
            oracleValue: null,
            detail: `dangling reference {${ref}} resolves to no measure or dimension`,
            rootCauseKey: `dangling-ref:${cube.logical}.${m.name}->${ref}`,
          }),
        );
      }
    }
  }
}

function checkRollups(cube, findings) {
  const measureType = new Map(cube.measures.map((m) => [m.name, m.type]));
  for (const pa of cube.preAggs) {
    // Only plain rollups must hold additive measures; rollupJoin/lambda/originalSql
    // are checked elsewhere or not at all.
    if (pa.type === 'rollup') {
      for (const mName of pa.measures) {
        const t = measureType.get(mName);
        if (t && !ADDITIVE_MEASURE_TYPES.has(t)) {
          findings.push(
            finding(cube, {
              dimension: 'rollup',
              severity: 'correctness',
              line: pa.line,
              devValue: `rollup ${pa.name} includes non-additive measure ${mName} (${t})`,
              oracleValue: null,
              detail: `pre-agg rollups must contain only additive measures; ${t} is not additive`,
              rootCauseKey: `rollup-nonadditive:${cube.logical}.${pa.name}.${mName}`,
            }),
          );
        }
      }
      // time_dimension present without granularity (or vice versa) is a build smell.
      const hasTd = pa.timeDimension != null;
      const hasGran = pa.granularity != null;
      if (hasTd !== hasGran) {
        findings.push(
          finding(cube, {
            dimension: 'rollup',
            severity: 'parity',
            line: pa.line,
            devValue: `rollup ${pa.name}: time_dimension=${pa.timeDimension} granularity=${pa.granularity}`,
            oracleValue: null,
            detail: 'rollup declares time_dimension XOR granularity — both or neither expected',
            rootCauseKey: `rollup-time-mismatch:${cube.logical}.${pa.name}`,
          }),
        );
      }
    }
  }
}

function checkPrimaryKey(cube, joinTargets, findings) {
  if (cube.primaryKeys.length > 0) return;
  // A cube with no PK is only a problem if something joins to it, or it exposes
  // count_distinct measures (which need a stable grain). Pure aggregate marts
  // (sql_table marts with only sums) are legitimately PK-less.
  const joinedTo = joinTargets.has(cube.logical) || joinTargets.has(cube.cubeName);
  if (joinedTo) {
    findings.push(
      finding(cube, {
        dimension: 'pk',
        severity: 'correctness',
        line: cube.nameLine,
        devValue: `${cube.cubeName} has no primary_key dimension`,
        oracleValue: null,
        detail: 'cube is a join target but declares no primary_key — fan-out risk',
        rootCauseKey: `missing-pk:${cube.logical}`,
      }),
    );
  }
}

function checkRatioTruncation(cube, findings) {
  for (const m of cube.measures) {
    if (m.type !== 'number' || typeof m.sql !== 'string') continue;
    const sql = m.sql;
    if (!sql.includes('/')) continue;
    const hasCast = /CAST\s*\(/i.test(sql) || /\*\s*1\.0/.test(sql) || /\bAS\s+DOUBLE\b/i.test(sql);
    if (!hasCast) {
      findings.push(
        finding(cube, {
          dimension: 'ratio',
          severity: 'cosmetic',
          line: m.line,
          devValue: `${m.name}.sql = ${sql}`,
          oracleValue: null,
          detail: 'division without explicit double cast — integer truncation risk in Trino',
          rootCauseKey: `ratio-truncation:${cube.logical}.${m.name}`,
        }),
      );
    }
  }
}

function tagIdentityJoins(cube, findings) {
  for (const j of cube.joins) {
    if (typeof j.sql === 'string' && /split_part\s*\(/i.test(j.sql) && j.sql.includes("'@'")) {
      findings.push(
        finding(cube, {
          dimension: 'identity',
          severity: 'cosmetic',
          line: j.line,
          devValue: `join ${j.name}: ${j.sql}`,
          oracleValue: null,
          detail: 'identity-bridge join via split_part(..,"@",1) — verify match rate is acceptable',
          rootCauseKey: `identity-bridge:${cube.logical}.${j.name}`,
        }),
      );
    }
  }
}

/** Set of cube names that appear as a join target anywhere in the game's dev model. */
export function collectJoinTargets(devCubes) {
  const targets = new Set();
  for (const c of devCubes) for (const j of c.joins) targets.add(j.name);
  return targets;
}

/** Run all canonical rules over one dev cube. */
export function runCanonicalRules(cube, joinTargets) {
  const findings = [];
  checkDanglingRefs(cube, findings);
  checkRollups(cube, findings);
  checkPrimaryKey(cube, joinTargets, findings);
  checkRatioTruncation(cube, findings);
  tagIdentityJoins(cube, findings);
  return findings;
}
