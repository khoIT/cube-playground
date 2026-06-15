/**
 * experimentGateStatus turns a draft's quality scorecard into the Decide
 * hand-off gate: hard-stop on a failing CRITICAL dimension, advisory warning on
 * a failing non-critical one, and never block when no scorecard is present.
 */

import { describe, it, expect } from 'vitest';
import type { DimensionScore, ExperimentScorecard } from '../../../api/advisor';
import { experimentGateStatus } from '../experiment-gate';

function dim(
  dimension: DimensionScore['dimension'],
  pass: boolean,
  critical: boolean,
): DimensionScore {
  return { dimension, score: pass ? 1 : 0, pass, critical, detail: `${dimension} ${pass ? 'ok' : 'fail'}` };
}

function card(dimensions: DimensionScore[]): ExperimentScorecard {
  const overall = dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length;
  const pass = dimensions.every((d) => !d.critical || d.pass) && overall >= 0.7;
  return { draftId: 'seg::cand', dimensions, overall, pass };
}

describe('experimentGateStatus', () => {
  it('does not block when no scorecard is present (back-compat)', () => {
    expect(experimentGateStatus(undefined).blocked).toBe(false);
    expect(experimentGateStatus(null).blocked).toBe(false);
  });

  it('blocks on a failing critical dimension', () => {
    const sc = card([
      dim('power', false, true),
      dim('feasibility', true, true),
      dim('provenance', true, true),
      dim('materiality', true, false),
      dim('goalFit', true, false),
    ]);
    const gate = experimentGateStatus(sc);
    expect(gate.blocked).toBe(true);
    expect(gate.criticalFails.map((d) => d.dimension)).toEqual(['power']);
    expect(gate.warnings).toHaveLength(0);
  });

  it('warns (does not block) on a failing non-critical dimension only', () => {
    const sc = card([
      dim('power', true, true),
      dim('feasibility', true, true),
      dim('provenance', true, true),
      dim('materiality', false, false),
      dim('goalFit', false, false),
    ]);
    const gate = experimentGateStatus(sc);
    expect(gate.blocked).toBe(false);
    expect(gate.criticalFails).toHaveLength(0);
    expect(gate.warnings.map((d) => d.dimension)).toEqual(['materiality', 'goalFit']);
  });

  it('reports every failing critical dimension when several fail', () => {
    const sc = card([
      dim('power', false, true),
      dim('feasibility', false, true),
      dim('provenance', false, true),
      dim('materiality', true, false),
      dim('goalFit', true, false),
    ]);
    const gate = experimentGateStatus(sc);
    expect(gate.blocked).toBe(true);
    expect(gate.criticalFails.map((d) => d.dimension)).toEqual(['power', 'feasibility', 'provenance']);
  });
});
