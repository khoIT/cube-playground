/**
 * compose() injection of smart-default guidance (P3) and asking posture (P4).
 * Both sit in the cacheable prefix; both are absent when not passed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const MASTER_BODY = '# Cube Playground\n\nAnalytics assistant.';
const EXPLORE_SKILL = {
  name: 'explore',
  displayName: 'Explore',
  description: 'x',
  triggerKeywords: ['show'],
  allowedTools: ['offer_choices', 'emit_query_artifact'],
  body: '# Explore Skill',
};

vi.mock('../../src/core/skill-loader.js', () => ({
  loadSkill: (name: string) => (name === 'explore' ? EXPLORE_SKILL : null),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: string) => (String(p).endsWith('cube-playground.md') ? true : actual.existsSync(p)),
    readFileSync: (p: unknown, enc: unknown) =>
      String(p).endsWith('cube-playground.md') ? MASTER_BODY : actual.readFileSync(p as string, enc as BufferEncoding),
  };
});

import { compose, _resetMasterCache } from '../../src/core/mode-prompts.js';

describe('compose() smart-defaults + posture injection', () => {
  beforeEach(() => _resetMasterCache());

  it('injects smart-default guidance before the field-chip block (cacheable prefix)', () => {
    const { systemPrompt } = compose({
      skill: 'explore',
      game: 'cfm_vn',
      smartDefaults: '## Smart defaults\n\nDefault metric = Revenue.',
    });
    const sdIdx = systemPrompt.indexOf('## Smart defaults');
    const fieldChipIdx = systemPrompt.indexOf('## Field chip token');
    expect(sdIdx).toBeGreaterThan(0);
    expect(fieldChipIdx).toBeGreaterThan(sdIdx);
  });

  it('injects the aggressive posture block when agentPosture=aggressive', () => {
    const { systemPrompt } = compose({ skill: 'explore', game: 'cfm_vn', agentPosture: 'aggressive' });
    expect(systemPrompt).toContain('## Asking posture: auto-answer');
    expect(systemPrompt).not.toContain('## Asking posture: confirm first');
  });

  it('injects the targeted posture block when agentPosture=targeted', () => {
    const { systemPrompt } = compose({ skill: 'explore', game: 'cfm_vn', agentPosture: 'targeted' });
    expect(systemPrompt).toContain('## Asking posture: confirm first');
    expect(systemPrompt).not.toContain('## Asking posture: auto-answer');
  });

  it('omits both blocks when neither is passed (flags off → no behavior change)', () => {
    const { systemPrompt } = compose({ skill: 'explore', game: 'cfm_vn' });
    expect(systemPrompt).not.toContain('## Smart defaults');
    expect(systemPrompt).not.toContain('## Asking posture');
  });
});
