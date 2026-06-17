/**
 * compose() injection of the model-graph digest (P1).
 * Verifies the digest lands in the cacheable prefix — after the active-game
 * line, before the per-turn-variable language/context blocks — and is absent
 * (byte-identical to pre-digest output) when no digest is passed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const MASTER_BODY = '# Cube Playground\n\nAnalytics assistant.';
const EXPLORE_SKILL = {
  name: 'explore',
  displayName: 'Explore',
  description: 'x',
  triggerKeywords: ['show'],
  allowedTools: ['offer_choices', 'emit_query_artifact'],
  body: '# Explore Skill\n\nStep 1.',
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

const DIGEST = '## Data model (cfm_vn)\n\nHub: mf_users (pk user_id).';

describe('compose() model-digest injection', () => {
  beforeEach(() => _resetMasterCache());

  it('injects the digest after the active-game line', () => {
    const { systemPrompt } = compose({ skill: 'explore', game: 'cfm_vn', modelDigest: DIGEST });
    expect(systemPrompt).toContain('## Data model (cfm_vn)');
    const gameIdx = systemPrompt.indexOf('## Active game');
    const digestIdx = systemPrompt.indexOf('## Data model');
    const fieldChipIdx = systemPrompt.indexOf('## Field chip token');
    expect(gameIdx).toBeGreaterThanOrEqual(0);
    expect(digestIdx).toBeGreaterThan(gameIdx);
    expect(fieldChipIdx).toBeGreaterThan(digestIdx);
  });

  it('places the digest before per-turn-variable content (language directive)', () => {
    const { systemPrompt } = compose({
      skill: 'explore',
      game: 'cfm_vn',
      modelDigest: DIGEST,
      language: 'vi',
    });
    const digestIdx = systemPrompt.indexOf('## Data model');
    const langIdx = systemPrompt.indexOf('LANGUAGE DIRECTIVE');
    expect(langIdx).toBeGreaterThan(digestIdx);
  });

  it('is omitted entirely when no digest is passed', () => {
    const { systemPrompt } = compose({ skill: 'explore', game: 'cfm_vn' });
    expect(systemPrompt).not.toContain('## Data model');
  });

  it('treats a blank digest as absent', () => {
    const withBlank = compose({ skill: 'explore', game: 'cfm_vn', modelDigest: '   ' }).systemPrompt;
    const without = compose({ skill: 'explore', game: 'cfm_vn' }).systemPrompt;
    expect(withBlank).toBe(without);
  });
});
