import { describe, it, expect } from 'vitest';
import { modeGate } from '../../src/nl-to-query/mode-gate.js';

describe('mode-gate', () => {
  it('targeted: clarifies whenever clarifications exist', () => {
    expect(
      modeGate({
        mode: 'targeted', overallConfidence: 0.99,
        clarifications: [{ slot: 'metric', question_en: '?', question_vi: '?' }],
      }),
    ).toBe('clarify');
  });

  it('targeted: auto when no clarifications', () => {
    expect(modeGate({ mode: 'targeted', overallConfidence: 0.4, clarifications: [] })).toBe('auto');
  });

  it('aggressive: auto when confidence >= threshold even with clarifications', () => {
    expect(
      modeGate({
        mode: 'aggressive', overallConfidence: 0.8, threshold: 0.75,
        clarifications: [{ slot: 'metric', question_en: '?', question_vi: '?' }],
      }),
    ).toBe('auto');
  });

  it('aggressive: clarifies when confidence < threshold', () => {
    expect(
      modeGate({
        mode: 'aggressive', overallConfidence: 0.5, threshold: 0.75,
        clarifications: [{ slot: 'metric', question_en: '?', question_vi: '?' }],
      }),
    ).toBe('clarify');
  });

  it('aggressive + no clarifications: always auto', () => {
    expect(modeGate({ mode: 'aggressive', overallConfidence: 0.2, clarifications: [] })).toBe('auto');
  });
});
