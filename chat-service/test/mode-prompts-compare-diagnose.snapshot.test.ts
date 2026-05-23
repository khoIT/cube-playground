/**
 * Snapshot tests for mode-prompts.compose() — compare and diagnose skills.
 *
 * Mocks:
 *   - skill-loader  → canned SkillMeta objects (no disk I/O)
 *   - node:fs       → canned master command string (no disk I/O)
 *
 * No timestamps or dynamic values are injected so snapshots are stable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Canned data — short bodies; snapshot tests structural composition only
// ---------------------------------------------------------------------------

const MASTER_BODY = `# Cube Playground

You are a data-analytics assistant for the Cube Playground platform.`;

const COMPARE_SKILL = {
  name: 'compare',
  displayName: 'Compare',
  description: 'Compare two subjects on a chosen metric.',
  triggerKeywords: ['compare', 'vs', 'versus'],
  allowedTools: [
    'get_cube_meta',
    'list_business_metrics',
    'get_business_metric',
    'list_segments',
    'get_segment',
    'preview_cube_query',
    'emit_query_artifact',
  ],
  body: `# Compare Skill\n\nStep 1: identify two subjects + metric.\nStep 2: preview each side.\nStep 3: emit artifact(s) with delta sentence.`,
};

const DIAGNOSE_SKILL = {
  name: 'diagnose',
  displayName: 'Diagnose',
  description: 'Find the most likely cause of a metric drop or spike.',
  triggerKeywords: ['why', 'drop', 'spike'],
  allowedTools: [
    'get_cube_meta',
    'list_business_metrics',
    'get_business_metric',
    'list_segments',
    'get_segment',
    'preview_cube_query',
    'explain_cube_sql',
    'emit_query_artifact',
  ],
  body: `# Diagnose Skill\n\nStep 1: intake symptom.\nStep 2: walk hypothesis tree.\nStep 3: emit explanatory artifact.`,
};

// ---------------------------------------------------------------------------
// Mocks — declared before module imports so vi.mock hoisting works
// ---------------------------------------------------------------------------

vi.mock('../src/core/skill-loader.js', () => ({
  loadSkill: (name: string) => {
    if (name === 'compare') return COMPARE_SKILL;
    if (name === 'diagnose') return DIAGNOSE_SKILL;
    return null;
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: string) => {
      if (String(p).endsWith('cube-playground.md')) return true;
      return actual.existsSync(p);
    },
    readFileSync: (p: unknown, enc: unknown) => {
      if (String(p).endsWith('cube-playground.md')) return MASTER_BODY;
      return actual.readFileSync(p as string, enc as BufferEncoding);
    },
  };
});

// ---------------------------------------------------------------------------
// Import AFTER mocks are registered
// ---------------------------------------------------------------------------

import { compose, _resetMasterCache } from '../src/core/mode-prompts.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mode-prompts.compose — compare + diagnose snapshots', () => {
  beforeEach(() => {
    _resetMasterCache();
  });

  it('compare skill with game "ptg" matches snapshot', () => {
    const result = compose({ skill: 'compare', game: 'ptg' });

    expect(result.allowedToolNames).toHaveLength(7);
    expect(result.allowedToolNames).toContain('emit_query_artifact');
    expect(result.allowedToolNames).not.toContain('explain_cube_sql');
    expect(result.systemPrompt).toMatchSnapshot();
  });

  it('diagnose skill with game "ptg" and contextPreamble matches snapshot', () => {
    const result = compose({
      skill: 'diagnose',
      game: 'ptg',
      contextPreamble: 'User asked why DAU dropped on 2026-05-20.',
    });

    expect(result.allowedToolNames).toHaveLength(8);
    expect(result.allowedToolNames).toContain('explain_cube_sql');
    expect(result.allowedToolNames).toContain('emit_query_artifact');
    expect(result.systemPrompt).toMatchSnapshot();
  });
});
