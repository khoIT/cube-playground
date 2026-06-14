/**
 * scanToolOutputForError — detects a failure embedded in an otherwise-ok tool
 * output (the diagnose-lens Cube-400 case that the ok/failed state alone hides).
 */

import { describe, it, expect } from 'vitest';
import { scanToolOutputForError } from '../src/advisor/agent/tool-output-error-scan.js';

describe('scanToolOutputForError', () => {
  it('returns null for empty / healthy output', () => {
    expect(scanToolOutputForError(undefined)).toBeNull();
    expect(scanToolOutputForError(null)).toBeNull();
    expect(scanToolOutputForError('{"rows":[{"x":1}],"evidence":{}}')).toBeNull();
  });

  it('does NOT flag a legitimately empty result set', () => {
    expect(scanToolOutputForError('{"candidates":[],"diagnosis":{"opportunities":[]}}')).toBeNull();
  });

  it('detects the Cube UserError "not found for path" case and extracts the message', () => {
    const digest =
      '{"verdict":"inconclusive","inputs":{"reason":"Cube /load → 400: ' +
      '{\\"type\\":\\"UserError\\",\\"error\\":\\"\'total_active_days\' not found for path ' +
      '\'mf_users.total_active_days\'\\"}"}}';
    const msg = scanToolOutputForError(digest);
    expect(msg).not.toBeNull();
    expect(msg!.toLowerCase()).toContain('not found for path');
  });

  it('detects a bare Cube /load → 400', () => {
    expect(scanToolOutputForError('Cube /load → 400: something broke')).not.toBeNull();
  });

  it('detects a generic upstream HTTP error', () => {
    expect(scanToolOutputForError('upstream → 503 service unavailable')).not.toBeNull();
  });

  it('bounds the extracted message length', () => {
    // Carries a real signature (UserError) plus a very long error string.
    const long = `{"type":"UserError","error":"${'x'.repeat(1000)}"}`;
    const msg = scanToolOutputForError(long);
    expect(msg).not.toBeNull();
    expect(msg!.length).toBeLessThanOrEqual(301);
  });
});
