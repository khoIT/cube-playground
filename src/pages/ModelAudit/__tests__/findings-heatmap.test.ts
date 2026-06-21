/**
 * buildGrid: union rows, worst-severity-per-cell, clean vs no-counterpart vs
 * absent classification.
 */

import { describe, it, expect } from 'vitest';
import { buildGrid } from '../findings-heatmap';
import type { ParityFinding, RunCube } from '../model-audit-types';

const cubes: RunCube[] = [
  { game: 'cfm', cube: 'recharge', hasProd: true },
  { game: 'jus', cube: 'recharge', hasProd: true },
  { game: 'muaw', cube: 'recharge', hasProd: false },
  { game: 'cfm', cube: 'mf_users', hasProd: true },
];

function f(game: string, cube: string, severity: string): ParityFinding {
  return {
    id: Math.random(),
    game,
    cube,
    dimension: 'pk',
    severity,
    devValue: null,
    oracleValue: null,
    detail: null,
    file: null,
    line: null,
    verdict: null,
    rootCauseKey: `${cube}-${severity}`,
  };
}

describe('buildGrid', () => {
  const games = ['cfm', 'jus', 'muaw'];
  const findings = [f('cfm', 'recharge', 'cosmetic'), f('cfm', 'recharge', 'correctness'), f('jus', 'recharge', 'parity')];
  const { rows, cellOf } = buildGrid(games, cubes, findings);

  it('rows = sorted union of cube names', () => {
    expect(rows).toEqual(['mf_users', 'recharge']);
  });

  it('cell worst severity wins (correctness > cosmetic)', () => {
    expect(cellOf('cfm', 'recharge').worst).toBe('correctness');
    expect(cellOf('cfm', 'recharge').count).toBe(2);
  });

  it('cell with one finding takes that severity', () => {
    expect(cellOf('jus', 'recharge').worst).toBe('parity');
  });

  it('present cube with no finding is clean (worst=null, present, hasProd)', () => {
    const c = cellOf('cfm', 'mf_users');
    expect(c.present).toBe(true);
    expect(c.worst).toBeNull();
    expect(c.hasProd).toBe(true);
  });

  it('no-counterpart cube is present but hasProd=false', () => {
    const c = cellOf('muaw', 'recharge');
    expect(c.present).toBe(true);
    expect(c.hasProd).toBe(false);
  });

  it('absent cube×game is not present', () => {
    expect(cellOf('jus', 'mf_users').present).toBe(false);
  });
});
