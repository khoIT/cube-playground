/**
 * Structural diff of a dev cube against its prod-clone oracle counterpart,
 * paired by logical entity name. These are PARITY findings (verdict pending):
 * the oracle is the validated reference, but dev/oracle divergence is often
 * intentional (e.g. dev `recharge` sources the raw etl table + identity bridge
 * while the oracle sources the standardized std table). The harness flags;
 * a human verifies each against the actual files before any fix.
 *
 * Emitted facets:
 *   - measure present in oracle, missing in dev   → possible parity gap
 *   - measure present in dev, missing in oracle   → possible dev-ahead
 *   - primary-key set differs                     → verify grain
 *   - dev cube has no oracle counterpart          → no-counterpart (informational)
 */

function finding(game, logical, file, partial) {
  return { game, cube: logical, file, verdict: null, ...partial };
}

/** Index oracle cubes by logical name for this game. */
function oracleIndex(oracleCubes) {
  const idx = new Map();
  for (const c of oracleCubes) idx.set(c.logical, c);
  return idx;
}

function diffMeasures(dev, oracle, findings) {
  const devM = new Set(dev.measures.map((m) => m.name));
  const oraM = new Set(oracle.measures.map((m) => m.name));
  for (const m of oracle.measures) {
    if (!devM.has(m.name)) {
      findings.push(
        finding(dev.game, dev.logical, dev.file, {
          dimension: 'measure',
          severity: 'parity',
          line: dev.nameLine,
          devValue: null,
          oracleValue: `measure ${m.name} (${m.type})`,
          detail: `oracle ${oracle.cubeName} defines measure ${m.name}; dev cube lacks it`,
          rootCauseKey: `measure-missing-vs-oracle:${dev.logical}.${m.name}`,
        }),
      );
    }
  }
  for (const m of dev.measures) {
    if (!oraM.has(m.name)) {
      findings.push(
        finding(dev.game, dev.logical, dev.file, {
          dimension: 'measure',
          severity: 'cosmetic',
          line: m.line,
          devValue: `measure ${m.name} (${m.type})`,
          oracleValue: null,
          detail: `dev defines measure ${m.name} not present in oracle ${oracle.cubeName} (dev-ahead candidate)`,
          rootCauseKey: `measure-dev-ahead:${dev.logical}.${m.name}`,
        }),
      );
    }
  }
}

function diffPrimaryKeys(dev, oracle, findings) {
  const devPk = [...dev.primaryKeys].sort().join('+') || '(none)';
  const oraPk = [...oracle.primaryKeys].sort().join('+') || '(none)';
  if (devPk !== oraPk) {
    findings.push(
      finding(dev.game, dev.logical, dev.file, {
        dimension: 'pk',
        severity: 'parity',
        line: dev.nameLine,
        devValue: `primary_key = ${devPk}`,
        oracleValue: `primary_key = ${oraPk}`,
        detail: 'primary-key set differs from oracle — verify grain / fan-out',
        rootCauseKey: `pk-differs-vs-oracle:${dev.logical}`,
      }),
    );
  }
}

/**
 * Diff every dev cube for one game against the game's oracle.
 * Returns { findings[], counterpart: Map(logical -> bool) } so the matrix can
 * mark which dev cubes had an oracle to compare against.
 */
export function diffGameAgainstOracle(gameModel) {
  const { dev, oracle, oracleAvailable } = gameModel;
  const findings = [];
  const counterpart = new Map();
  if (!oracleAvailable) {
    for (const c of dev) counterpart.set(c.logical, false);
    return { findings, counterpart };
  }
  const idx = oracleIndex(oracle);
  for (const c of dev) {
    const o = idx.get(c.logical);
    if (!o) {
      counterpart.set(c.logical, false);
      findings.push(
        finding(c.game, c.logical, c.file, {
          dimension: 'structure',
          severity: 'cosmetic',
          line: c.nameLine,
          devValue: `dev cube ${c.cubeName}`,
          oracleValue: null,
          detail: 'no oracle counterpart — dev-only cube (informational)',
          rootCauseKey: `no-oracle-counterpart:${c.logical}`,
        }),
      );
      continue;
    }
    counterpart.set(c.logical, true);
    diffMeasures(c, o, findings);
    diffPrimaryKeys(c, o, findings);
  }
  return { findings, counterpart };
}
