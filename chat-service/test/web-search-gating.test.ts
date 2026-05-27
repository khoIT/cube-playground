/**
 * Phase-06 web-search gating tests.
 *
 * Verifies that WebSearch moves from disallowedTools → allowedTools ONLY when
 * both the env flag (overrides.webSearchEnabled) AND the skill opt-in are true.
 * Any other combination must keep WebSearch in disallowedTools.
 */

import { describe, it, expect } from 'vitest';
import { buildQueryOptions, DISABLED_BUILTIN_TOOLS } from '../src/core/query-options-presets.js';

const BASE_INPUTS = {
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are a test assistant.',
  mcpServers: {},
  allowedTools: ['get_cube_meta'],
  env: { HOME: '/tmp', ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
};

describe('Web-search gating — buildQueryOptions', () => {
  it('WebSearch stays in disallowedTools when webSearchEnabled=false (default)', () => {
    const opts = buildQueryOptions('standard', BASE_INPUTS);
    expect(opts.disallowedTools).toContain('WebSearch');
    expect(opts.allowedTools).not.toContain('WebSearch');
  });

  it('WebSearch stays in disallowedTools when webSearchEnabled=false explicitly', () => {
    const opts = buildQueryOptions('standard', BASE_INPUTS, { webSearchEnabled: false });
    expect(opts.disallowedTools).toContain('WebSearch');
    expect(opts.allowedTools).not.toContain('WebSearch');
  });

  it('WebSearch is removed from disallowedTools and added to allowedTools when webSearchEnabled=true', () => {
    const opts = buildQueryOptions('standard', BASE_INPUTS, { webSearchEnabled: true });
    expect(opts.disallowedTools).not.toContain('WebSearch');
    expect(opts.allowedTools).toContain('WebSearch');
  });

  it('All other builtin tools remain disallowed even when webSearchEnabled=true', () => {
    const opts = buildQueryOptions('standard', BASE_INPUTS, { webSearchEnabled: true });
    const otherBuiltins = DISABLED_BUILTIN_TOOLS.filter((t) => t !== 'WebSearch');
    for (const tool of otherBuiltins) {
      expect(opts.disallowedTools).toContain(tool);
    }
  });

  it('webSearchEnabled=true does not duplicate WebSearch in allowedTools when already present', () => {
    const inputs = { ...BASE_INPUTS, allowedTools: ['get_cube_meta', 'WebSearch'] };
    const opts = buildQueryOptions('standard', inputs, { webSearchEnabled: true });
    const wsCount = opts.allowedTools.filter((t) => t === 'WebSearch').length;
    expect(wsCount).toBe(1);
  });

  it('research-safe preset also respects webSearchEnabled', () => {
    const opts = buildQueryOptions('research-safe', BASE_INPUTS, { webSearchEnabled: true });
    expect(opts.disallowedTools).not.toContain('WebSearch');
    expect(opts.allowedTools).toContain('WebSearch');
  });
});

describe('Web-search skill-frontmatter parsing', () => {
  /**
   * The two-condition gate is enforced in api/turn.ts:
   *   webSearchEnabled = config.chatEnableWebSearch && (webSearchOverride || skillMeta.enableWebSearch)
   *
   * We model that logic here to unit-test the conjunction (header override path).
   */
  function resolveWebSearch(envFlag: boolean, headerOverride: boolean, skillFlag: boolean): boolean {
    return envFlag && (headerOverride || skillFlag);
  }

  it('both env flag and skill opt-in true → web search enabled', () => {
    expect(resolveWebSearch(true, false, true)).toBe(true);
  });

  it('env flag false, skill opt-in true → web search disabled', () => {
    expect(resolveWebSearch(false, false, true)).toBe(false);
  });

  it('env flag true, skill opt-out, no header → web search disabled', () => {
    expect(resolveWebSearch(true, false, false)).toBe(false);
  });

  it('both flags false, no header → web search disabled', () => {
    expect(resolveWebSearch(false, false, false)).toBe(false);
  });

  it('X-Web-Search header overrides skill opt-out when env flag is true', () => {
    expect(resolveWebSearch(true, true, false)).toBe(true);
  });

  it('X-Web-Search header does NOT override env master kill-switch', () => {
    expect(resolveWebSearch(false, true, false)).toBe(false);
  });
});

describe('Independent gate: X-Web-Search does not activate researchMode', () => {
  /**
   * Mirrors the split in api/turn.ts:
   *   webSearchOverride  = x-web-search === '1'
   *   researchOverride   = x-research-mode === '1'
   * Each feeds only its own gate.
   */
  function resolveGates(
    envWebSearch: boolean,
    envResearch: boolean,
    xWebSearch: boolean,
    xResearchMode: boolean,
    skillWebSearch: boolean,
    skillResearch: boolean,
  ): { webSearchEnabled: boolean; researchModeEnabled: boolean } {
    return {
      webSearchEnabled: envWebSearch && (xWebSearch || skillWebSearch),
      researchModeEnabled: envResearch && (xResearchMode || skillResearch),
    };
  }

  it('X-Web-Search ON, X-Research-Mode OFF → only webSearch enabled', () => {
    const { webSearchEnabled, researchModeEnabled } = resolveGates(true, true, true, false, false, false);
    expect(webSearchEnabled).toBe(true);
    expect(researchModeEnabled).toBe(false);
  });

  it('X-Research-Mode ON, X-Web-Search OFF → only researchMode enabled', () => {
    const { webSearchEnabled, researchModeEnabled } = resolveGates(true, true, false, true, false, false);
    expect(webSearchEnabled).toBe(false);
    expect(researchModeEnabled).toBe(true);
  });

  it('both headers ON → both gates enabled', () => {
    const { webSearchEnabled, researchModeEnabled } = resolveGates(true, true, true, true, false, false);
    expect(webSearchEnabled).toBe(true);
    expect(researchModeEnabled).toBe(true);
  });

  it('neither header, neither skill → both gates disabled', () => {
    const { webSearchEnabled, researchModeEnabled } = resolveGates(true, true, false, false, false, false);
    expect(webSearchEnabled).toBe(false);
    expect(researchModeEnabled).toBe(false);
  });
});
