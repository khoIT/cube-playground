/**
 * Scorer: diff a re-run snapshot against the frozen baseline.
 *
 * Per-question verdict:
 *   match              — resolved metric + cube both agree with baseline
 *   mismatch           — at least one field differs from baseline
 *   query-shape-changed — metric/cube match but emitted query structure differs
 *                        (flagged, NOT auto-failed — shape changes may be intentional)
 *   no-artifact        — produced artifact in baseline but not in re-run
 *   newly-working      — no artifact in baseline, now produces one
 *   both-failing       — no artifact in either run
 *   baseline-missing   — corpus case has no matching baseline entry
 *
 * Usage:
 *   tsx test/metric-resolution-eval/metric-resolution-scorer.ts \
 *       [baseline.json] [rerun.json]
 *
 * Defaults to cfm-vn-baseline-snapshot.json vs cfm-vn-rerun-snapshot.json
 * in the same directory. Pass --json to emit machine-readable ScoreReport.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type {
  BaselineSnapshot,
  BaselineResult,
  EvalCorpus,
  ScoredCase,
  ScoreReport,
  MatchVerdict,
} from './types.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSnapshot(path: string): BaselineSnapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as BaselineSnapshot;
}

function loadCorpus(path: string): EvalCorpus {
  return JSON.parse(readFileSync(path, 'utf8')) as EvalCorpus;
}

function queryShapeSummary(queries: unknown[]): string {
  if (queries.length === 0) return '(none)';
  const q = queries[0] as Record<string, unknown>;
  const measures = (q['measures'] as string[] | undefined) ?? [];
  const dims = (q['dimensions'] as string[] | undefined) ?? [];
  const td = (q['timeDimensions'] as unknown[] | undefined) ?? [];
  return `measures=[${measures.join(',')}] dims=[${dims.join(',')}] td=${td.length}`;
}

function queryShapeDiff(baseline: BaselineResult, rerun: BaselineResult): string | undefined {
  const bSummary = queryShapeSummary(baseline.emittedQueries);
  const rSummary = queryShapeSummary(rerun.emittedQueries);
  return bSummary !== rSummary ? `baseline: ${bSummary} | rerun: ${rSummary}` : undefined;
}

function pickVerdict(
  baseline: BaselineResult | undefined,
  rerun: BaselineResult,
): MatchVerdict {
  if (!baseline) return 'baseline-missing';

  const bOk = baseline.status === 'ok';
  const rOk = rerun.status === 'ok';

  if (!bOk && !rOk) return 'both-failing';
  if (!bOk && rOk) return 'newly-working';
  if (bOk && !rOk) return 'no-artifact';

  // Both ok — compare resolved fields
  const metricMatch = baseline.resolvedMetricId === rerun.resolvedMetricId;
  const cubeMatch = baseline.resolvedCube === rerun.resolvedCube;

  if (!metricMatch || !cubeMatch) return 'mismatch';

  // Fields match — check query shape
  const diff = queryShapeDiff(baseline, rerun);
  return diff ? 'query-shape-changed' : 'match';
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

function score(baselinePath: string, rerunPath: string): ScoreReport {
  const baseline = loadSnapshot(baselinePath);
  const rerun = loadSnapshot(rerunPath);
  const corpus = loadCorpus(join(__dir, 'cfm-vn-eval-corpus.json'));

  const baselineMap = new Map<string, BaselineResult>(
    baseline.results.map((r) => [r.caseId, r]),
  );
  const rerunMap = new Map<string, BaselineResult>(
    rerun.results.map((r) => [r.caseId, r]),
  );

  const corpusGroupMap = new Map<string, string>(
    corpus.cases.map((c) => [c.id, c.curationGroup]),
  );
  const corpusNoteMap = new Map<string, string | undefined>(
    corpus.cases.map((c) => [c.id, c.note]),
  );

  // Score every case present in the re-run
  const cases: ScoredCase[] = [];
  for (const rerunResult of rerun.results) {
    const baselineResult = baselineMap.get(rerunResult.caseId);
    const verdict = pickVerdict(baselineResult, rerunResult);
    const diff =
      verdict === 'query-shape-changed' && baselineResult
        ? queryShapeDiff(baselineResult, rerunResult)
        : undefined;

    cases.push({
      caseId: rerunResult.caseId,
      question: rerunResult.question,
      curationGroup: corpusGroupMap.get(rerunResult.caseId) ?? 'unknown',
      verdict,
      baseline: baselineResult
        ? {
            resolvedMetricId: baselineResult.resolvedMetricId,
            resolvedCube: baselineResult.resolvedCube,
            status: baselineResult.status,
          }
        : null,
      rerun: {
        resolvedMetricId: rerunResult.resolvedMetricId,
        resolvedCube: rerunResult.resolvedCube,
        status: rerunResult.status,
      },
      queryShapeDiff: diff,
      note: corpusNoteMap.get(rerunResult.caseId),
    });
  }

  // Flag corpus cases missing from the re-run
  for (const c of corpus.cases) {
    if (!rerunMap.has(c.id)) {
      cases.push({
        caseId: c.id,
        question: c.question,
        curationGroup: c.curationGroup,
        verdict: 'baseline-missing',
        baseline: baselineMap.get(c.id)
          ? {
              resolvedMetricId: baselineMap.get(c.id)!.resolvedMetricId,
              resolvedCube: baselineMap.get(c.id)!.resolvedCube,
              status: baselineMap.get(c.id)!.status,
            }
          : null,
        rerun: null,
        note: c.note,
      });
    }
  }

  return {
    scoredAt: new Date().toISOString(),
    baselineFile: baselinePath,
    rerunFile: rerunPath,
    totalCases: cases.length,
    match: cases.filter((c) => c.verdict === 'match').length,
    mismatch: cases.filter((c) => c.verdict === 'mismatch').length,
    queryShapeChanged: cases.filter((c) => c.verdict === 'query-shape-changed').length,
    noArtifact: cases.filter((c) => c.verdict === 'no-artifact').length,
    newlyWorking: cases.filter((c) => c.verdict === 'newly-working').length,
    bothFailing: cases.filter((c) => c.verdict === 'both-failing').length,
    cases,
  };
}

function printReport(report: ScoreReport): void {
  console.log('\n=== Metric Resolution Score Report ===');
  console.log(`Scored at: ${report.scoredAt}`);
  console.log(`Baseline:  ${report.baselineFile}`);
  console.log(`Re-run:    ${report.rerunFile}`);
  console.log('');
  console.log(`Total cases:         ${report.totalCases}`);
  console.log(`  match:             ${report.match}`);
  console.log(`  mismatch:          ${report.mismatch}  ← regressions`);
  console.log(`  query-shape-chg:   ${report.queryShapeChanged}  ← flagged (not auto-failed)`);
  console.log(`  no-artifact:       ${report.noArtifact}  ← regressions`);
  console.log(`  newly-working:     ${report.newlyWorking}  ← improvements`);
  console.log(`  both-failing:      ${report.bothFailing}`);

  const regressions = report.cases.filter(
    (c) => c.verdict === 'mismatch' || c.verdict === 'no-artifact',
  );
  if (regressions.length > 0) {
    console.log('\n--- Regressions ---');
    for (const c of regressions) {
      console.log(`  [${c.caseId}] (${c.curationGroup}) "${c.question.slice(0, 60)}"`);
      console.log(`    baseline: metric=${c.baseline?.resolvedMetricId} cube=${c.baseline?.resolvedCube}`);
      console.log(`    rerun:    metric=${c.rerun?.resolvedMetricId} cube=${c.rerun?.resolvedCube}`);
    }
  }

  const shaped = report.cases.filter((c) => c.verdict === 'query-shape-changed');
  if (shaped.length > 0) {
    console.log('\n--- Query Shape Changes (informational) ---');
    for (const c of shaped) {
      console.log(`  [${c.caseId}] ${c.queryShapeDiff}`);
    }
  }

  const score = report.totalCases > 0
    ? Math.round((report.match / report.totalCases) * 100)
    : 0;
  console.log(`\nMatch rate: ${report.match}/${report.totalCases} = ${score}%`);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const args = process.argv.slice(2).filter((a) => a !== '--json');
const emitJson = process.argv.includes('--json');

const baselinePath = args[0]
  ? resolve(args[0])
  : join(__dir, 'cfm-vn-baseline-snapshot.json');
const rerunPath = args[1]
  ? resolve(args[1])
  : join(__dir, 'cfm-vn-rerun-snapshot.json');

const report = score(baselinePath, rerunPath);

if (emitJson) {
  const outPath = join(__dir, 'cfm-vn-score-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Score report written → ${outPath}`);
} else {
  printReport(report);
}
