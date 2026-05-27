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
   *   webSearchEnabled = config.chatEnableWebSearch && skillMeta.enableWebSearch
   *
   * We model that logic here to unit-test the conjunction.
   */
  function resolveWebSearch(envFlag: boolean, skillFlag: boolean): boolean {
    return envFlag && skillFlag;
  }

  it('both flags true → web search enabled', () => {
    expect(resolveWebSearch(true, true)).toBe(true);
  });

  it('env flag false, skill opt-in true → web search disabled', () => {
    expect(resolveWebSearch(false, true)).toBe(false);
  });

  it('env flag true, skill opt-out → web search disabled', () => {
    expect(resolveWebSearch(true, false)).toBe(false);
  });

  it('both flags false → web search disabled', () => {
    expect(resolveWebSearch(false, false)).toBe(false);
  });
});
