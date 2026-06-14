/**
 * Fail-fast: when the spine decomposition query fails (e.g. a Cube 400), the
 * diagnosis must be tagged `blocked` — distinct from a healthy "no opportunities"
 * result — so the agent reports the failure instead of probing around it.
 */

import { describe, it, expect } from 'vitest';
import { diagnose } from '../src/advisor/diagnosis-engine.js';
import type { CubeReaderFn } from '../src/advisor/cube-read.js';
import type { WorkspaceCtx } from '../src/services/cube-client.js';
import type { DiagnosisInput } from '../src/advisor/diagnosis-types.js';

const STUB_CTX: WorkspaceCtx = { cubeApiUrl: 'http://stub', token: null };

const INPUT: DiagnosisInput = {
  scope: { kind: 'game', gameId: 'cfm_vn' },
  goal: 'revenue',
  asOf: new Date('2026-06-15T00:00:00Z'),
};

describe('diagnose — blocked vs healthy', () => {
  it('tags the diagnosis blocked when the decomposition query errors', async () => {
    const throwingReader: CubeReaderFn = async () => {
      throw new Error(
        "Cube /load → 400: {\"type\":\"UserError\",\"error\":\"'total_active_days' not found for path 'mf_users.total_active_days'\"}",
      );
    };
    const diagnosis = await diagnose(INPUT, STUB_CTX, throwingReader);
    expect(diagnosis.opportunities).toHaveLength(0);
    expect(diagnosis.blocked).toBeDefined();
    expect(diagnosis.blocked!.reason).toMatch(/not found for path|400/);
  });

  it('does NOT tag blocked for a legitimately empty cohort (zero payers)', async () => {
    const emptyReader: CubeReaderFn = async () => [
      { 'mf_users.paying_users': 0, 'mf_users.arppu_vnd': 0, 'mf_users.avg_total_active_days': 0 },
    ];
    const diagnosis = await diagnose(INPUT, STUB_CTX, emptyReader);
    expect(diagnosis.opportunities).toHaveLength(0);
    expect(diagnosis.blocked).toBeUndefined();
  });
});
