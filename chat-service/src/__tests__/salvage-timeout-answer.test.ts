import { describe, it, expect, vi } from 'vitest';
import {
  salvageTimeoutAnswer,
  deterministicTimeoutNotice,
  buildSalvagePrompt,
} from '../api/turn/salvage-timeout-answer.js';
import { isHeavyAnalysisQuestion } from '../api/turn/heavy-question-timeout.js';

const logger = { warn: vi.fn() };
const LONG_REASONING = 'Pulled install cohort 172047, active 140647, tutorial 132266. '.repeat(10);

function input(overrides: Partial<Parameters<typeof salvageTimeoutAnswer>[0]> = {}) {
  return {
    question: 'Funnel analysis for May 2026 install cohort',
    reasoningText: LONG_REASONING,
    artifactCount: 2,
    timeoutMs: 240_000,
    model: 'claude-sonnet-4-6',
    logger,
    ...overrides,
  };
}

describe('salvageTimeoutAnswer', () => {
  it('returns the salvaged LLM answer when the call succeeds', async () => {
    const out = await salvageTimeoutAnswer(
      input({ deps: { callLlm: async () => '## Partial funnel\n172,047 installs → …' } }),
    );
    expect(out).toContain('Partial funnel');
  });

  it('falls back to the deterministic notice on empty LLM response', async () => {
    const out = await salvageTimeoutAnswer(input({ deps: { callLlm: async () => '' } }));
    expect(out).toBe(deterministicTimeoutNotice(240_000, 2));
  });

  it('falls back to the deterministic notice when the LLM call throws', async () => {
    const out = await salvageTimeoutAnswer(
      input({ deps: { callLlm: async () => { throw new Error('boom'); } } }),
    );
    expect(out).toContain('exceeded the 4-minute analysis budget');
  });

  it('skips the LLM entirely when the reasoning transcript is trivial', async () => {
    const callLlm = vi.fn(async () => 'should not be called');
    const out = await salvageTimeoutAnswer(
      input({ reasoningText: 'too short', deps: { callLlm } }),
    );
    expect(callLlm).not.toHaveBeenCalled();
    expect(out).toContain('exceeded the 4-minute analysis budget');
  });

  it('prompt embeds the question and only the transcript tail', () => {
    const prompt = buildSalvagePrompt('Q?', 'TAIL');
    expect(prompt).toContain('Q?');
    expect(prompt).toContain('TAIL');
    expect(prompt).toContain('never invent numbers');
  });
});

describe('isHeavyAnalysisQuestion', () => {
  it('matches funnel/journey/milestone questions', () => {
    expect(
      isHeavyAnalysisQuestion(
        'Funnel analysis on users from install, login to major milestones in gameplay for install cohorts in May 2026',
      ),
    ).toBe(true);
    expect(isHeavyAnalysisQuestion('Show the user journey from signup to payer')).toBe(true);
  });

  it('does not match ordinary metric questions', () => {
    expect(isHeavyAnalysisQuestion('Show DAU for last week')).toBe(false);
    expect(isHeavyAnalysisQuestion('Compare revenue VN vs TH in May')).toBe(false);
  });
});
