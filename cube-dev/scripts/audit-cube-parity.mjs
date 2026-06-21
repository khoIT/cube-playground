#!/usr/bin/env node
/**
 * Cross-game Cube model correctness + parity audit (read-only).
 *
 * Fan-out per (game × cube): apply internal-consistency rules to every dev
 * cube, and structurally diff each against its prod-clone oracle counterpart.
 * Emits a JSONL finding ledger + a human-readable parity matrix. Never writes
 * to any cube model; never touches the prod clone.
 *
 * Usage:
 *   node scripts/audit-cube-parity.mjs            # write reports/ + print summary
 *   node scripts/audit-cube-parity.mjs --json     # emit findings JSON to stdout
 *   node scripts/audit-cube-parity.mjs --gate     # exit 1 if any correctness finding
 *   node scripts/audit-cube-parity.mjs --prod-root /path/to/cube-prod
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, PROD_ROOT_DEFAULT } from './lib/cube-parity/load-and-normalize.mjs';
import { runCanonicalRules, collectJoinTargets } from './lib/cube-parity/canonical-rules.mjs';
import { diffGameAgainstOracle } from './lib/cube-parity/oracle-diff.mjs';
import {
  writeFindingsJsonl,
  writeParityMatrix,
  countBySeverity,
} from './lib/cube-parity/emit.mjs';
import { writeBaseline, loadBaseline, diffAgainstBaseline } from './lib/cube-parity/baseline.mjs';

const BASELINE_DEFAULT = join(dirname(fileURLToPath(import.meta.url)), 'parity-baseline.json');

function parseArgs(argv) {
  // CUBE_PARITY_PROD_ROOT lets both the CLI and the server recorder point at the
  // same prod clone without hardcoding; --prod-root overrides it.
  const args = {
    json: false,
    gate: false,
    writeBaseline: false,
    baselinePath: BASELINE_DEFAULT,
    prodRoot: process.env.CUBE_PARITY_PROD_ROOT ?? PROD_ROOT_DEFAULT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--gate') args.gate = true;
    else if (a === '--write-baseline') args.writeBaseline = true;
    else if (a === '--baseline') args.baselinePath = argv[++i];
    else if (a === '--prod-root') args.prodRoot = argv[++i];
  }
  return args;
}

function runAudit(prodRoot) {
  const model = loadModel({ prodRoot });
  const findings = [];
  const parseErrors = [];
  const snapshots = []; // {side, game, cube, path, absPath} — for the persistence recorder
  for (const g of model.games) {
    parseErrors.push(...g.parseErrors);
    const joinTargets = collectJoinTargets(g.dev);
    for (const cube of g.dev) findings.push(...runCanonicalRules(cube, joinTargets));
    findings.push(...diffGameAgainstOracle(g).findings);
    for (const c of [...g.dev, ...g.oracle]) {
      snapshots.push({ side: c.side, game: c.game, cube: c.logical, path: c.file, absPath: c.absFile });
    }
  }
  return { model, findings, parseErrors, snapshots };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { model, findings, parseErrors, snapshots } = runAudit(args.prodRoot);
  const counts = countBySeverity(findings);

  if (args.writeBaseline) {
    const { path } = writeBaseline(findings, args.baselinePath);
    console.log(`Wrote parity baseline (${findings.length} accepted findings) → ${path}`);
    return;
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        prodRoot: model.prodRoot,
        games: model.games.map((g) => ({
          game: g.game,
          schema: g.schema,
          oracleAvailable: g.oracleAvailable,
          devCubes: g.dev.length,
          oracleCubes: g.oracle.length,
        })),
        counts,
        parseErrors,
        snapshots,
        findings,
      }),
    );
  } else {
    const jsonlPath = writeFindingsJsonl(findings);
    const matrixPath = writeParityMatrix(model, findings);
    console.log(`Cube parity audit — ${model.games.length} games, ${findings.length} findings`);
    console.log(
      `  🔴 ${counts.correctness} correctness · 🟡 ${counts.parity} parity · ⚪ ${counts.cosmetic} cosmetic`,
    );
    if (parseErrors.length) console.log(`  ⚠️  ${parseErrors.length} YAML parse error(s)`);
    console.log(`  ledger:  ${jsonlPath}`);
    console.log(`  matrix:  ${matrixPath}`);
  }

  if (args.gate) {
    // Prefer a baseline-aware gate: fail on any NEWLY introduced correctness
    // finding (one not in the accepted baseline). Without a baseline, fall back
    // to "any correctness finding fails" — equivalent while accepted correctness
    // is empty, which it is.
    const baseline = loadBaseline(args.baselinePath);
    if (baseline) {
      const { added, removed, newCorrectness } = diffAgainstBaseline(findings, baseline);
      if (!args.json) {
        console.log(
          `  gate vs baseline: ${added.length} new · ${removed.length} cleared · ${newCorrectness.length} new correctness`,
        );
        for (const f of newCorrectness) console.error(`  NEW correctness: ${f.game}/${f.cube} ${f.dimension} — ${f.detail ?? ''}`);
      }
      if (newCorrectness.length > 0) {
        if (!args.json) console.error(`GATE FAIL: ${newCorrectness.length} new correctness finding(s) vs baseline`);
        process.exit(1);
      }
    } else if (counts.correctness > 0) {
      if (!args.json) console.error(`GATE FAIL: ${counts.correctness} correctness finding(s) (no baseline present)`);
      process.exit(1);
    }
  }
}

main();
