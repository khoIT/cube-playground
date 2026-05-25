/**
 * Snapshot tests for mode-prompts.compose().
 *
 * Mocks:
 *   - skill-loader  → canned SkillMeta objects (no disk I/O)
 *   - node:fs       → canned master command string (no disk I/O)
 *
 * No timestamps or dynamic values are injected so snapshots are stable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Canned data
// ---------------------------------------------------------------------------

const MASTER_BODY = `# Cube Playground

You are a data-analytics assistant for the Cube Playground platform.`;

const EXPLORE_SKILL = {
  name: 'explore',
  displayName: 'Explore',
  description: 'Translate a question into a Cube query artifact.',
  triggerKeywords: ['show', 'chart'],
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
  body: `# Explore Skill\n\nStep 1: identify the metric.\nStep 2: emit the artifact.`,
};

const METRIC_EXPLAIN_SKILL = {
  name: 'metric_explain',
  displayName: 'Explain Metric',
  description: 'Explain a business metric in plain English.',
  triggerKeywords: ['what is', 'formula'],
  allowedTools: [
    'get_cube_meta',
    'list_business_metrics',
    'get_business_metric',
    'emit_query_artifact',
  ],
  body: `# Explain Metric Skill\n\nStep 1: search business metrics.\nStep 2: render description.`,
};

// ---------------------------------------------------------------------------
// Mocks — declared before module imports so vi.mock hoisting works
// ---------------------------------------------------------------------------

vi.mock('../src/core/skill-loader.js', () => ({
  loadSkill: (name: string) => {
    if (name === 'explore') return EXPLORE_SKILL;
    if (name === 'metric_explain') return METRIC_EXPLAIN_SKILL;
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

describe('mode-prompts.compose — snapshots', () => {
  beforeEach(() => {
    // Clear the module-level master-command cache between tests so the mock
    // fs.readFileSync is exercised cleanly each time.
    _resetMasterCache();
  });

  it('explore skill with game "ptg" matches snapshot', () => {
    const result = compose({ skill: 'explore', game: 'ptg' });

    expect(result.allowedToolNames).toHaveLength(8);
    expect(result.allowedToolNames).toContain('emit_query_artifact');
    expect(result.systemPrompt).toMatchSnapshot();
  });

  it('metric_explain skill with game "ptg" and contextPreamble matches snapshot', () => {
    const result = compose({
      skill: 'metric_explain',
      game: 'ptg',
      contextPreamble: 'User just asked about ROAS.',
    });

    expect(result.allowedToolNames).toHaveLength(4);
    expect(result.allowedToolNames).toEqual([
      'get_cube_meta',
      'list_business_metrics',
      'get_business_metric',
      'emit_query_artifact',
    ]);
    expect(result.systemPrompt).toMatchSnapshot();
  });

  it('unknown skill falls back to explore + logs console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = compose({ skill: 'nope', game: 'ptg' });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"nope"'),
    );
    expect(result.allowedToolNames).toHaveLength(8); // explore's tools
    expect(result.systemPrompt).toContain('Explore'); // falls back to explore body

    warnSpy.mockRestore();
  });

  // Prefix-stability guarantee for Anthropic's automatic prefix cache: two
  // compose() calls with identical inputs MUST produce byte-identical output.
  // Any non-determinism here (Date.now, Math.random, Map iteration order)
  // would invalidate the SDK's prompt cache every turn.
  it('compose is byte-stable across calls with identical inputs', () => {
    const a = compose({
      skill: 'explore',
      game: 'ptg',
      contextPreamble: 'page=/dashboard',
    });
    const b = compose({
      skill: 'explore',
      game: 'ptg',
      contextPreamble: 'page=/dashboard',
    });
    expect(b.systemPrompt).toBe(a.systemPrompt);
    expect(b.allowedToolNames).toEqual(a.allowedToolNames);
  });

  it('compose is byte-stable across calls with no contextPreamble', () => {
    const a = compose({ skill: 'metric_explain', game: 'ballistar' });
    const b = compose({ skill: 'metric_explain', game: 'ballistar' });
    expect(b.systemPrompt).toBe(a.systemPrompt);
  });

  it('missing master command file is handled gracefully', async () => {
    // Temporarily reroute existsSync via vi.spyOn for this test only.
    const fs = await import('node:fs');
    const spy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (String(p).endsWith('cube-playground.md')) return false;
      return true;
    });
    _resetMasterCache();

    const result = compose({ skill: 'explore', game: 'ptg' });
    expect(result.systemPrompt).not.toContain('Cube Playground');
    expect(result.systemPrompt).toContain('Explore'); // skill body still present

    spy.mockRestore();
    _resetMasterCache(); // ensure subsequent tests get the real cached value
  });
});
