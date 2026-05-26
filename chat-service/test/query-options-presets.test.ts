/**
 * Tests for the SDK query-options factory. Snapshot of the `'standard'`
 * preset locks in the verbatim pre-phase-00 behaviour so a future refactor
 * cannot silently change what reaches the SDK.
 */

import { describe, it, expect } from 'vitest';
import {
  buildQueryOptions,
  DISABLED_BUILTIN_TOOLS,
} from '../src/core/query-options-presets.js';

const STD_INPUTS = {
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are a test assistant.',
  mcpServers: { 'cube-playground-tools': { fake: true } },
  allowedTools: ['get_cube_meta', 'emit_chart'],
  env: {
    HOME: '/tmp/claude-home',
    ANTHROPIC_API_KEY: 'sk-test',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  },
};

describe('buildQueryOptions — standard preset', () => {
  it('produces the verbatim pre-phase-00 options shape', () => {
    const opts = buildQueryOptions('standard', STD_INPUTS);

    expect(opts).toEqual({
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a test assistant.',
      mcpServers: { 'cube-playground-tools': { fake: true } },
      allowedTools: ['get_cube_meta', 'emit_chart'],
      disallowedTools: ['Read', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Edit', 'MultiEdit'],
      permissionMode: 'bypassPermissions',
      env: STD_INPUTS.env,
    });
  });

  it('does not emit resume or abortSignal when no overrides', () => {
    const opts = buildQueryOptions('standard', STD_INPUTS);
    expect(opts.resume).toBeUndefined();
    expect(opts.abortSignal).toBeUndefined();
  });

  it('exports DISABLED_BUILTIN_TOOLS as a frozen list', () => {
    expect(Object.isFrozen(DISABLED_BUILTIN_TOOLS)).toBe(true);
    expect(DISABLED_BUILTIN_TOOLS).toContain('Read');
    expect(DISABLED_BUILTIN_TOOLS).toContain('Bash');
    expect(DISABLED_BUILTIN_TOOLS).toContain('WebSearch');
  });

  it('returns a fresh disallowedTools array per call (cannot mutate frozen source)', () => {
    const a = buildQueryOptions('standard', STD_INPUTS);
    const b = buildQueryOptions('standard', STD_INPUTS);
    expect(a.disallowedTools).not.toBe(b.disallowedTools);
    // Mutating the returned array must not touch the frozen source.
    a.disallowedTools.push('Extra');
    expect(DISABLED_BUILTIN_TOOLS).not.toContain('Extra');
  });
});

describe('buildQueryOptions — overrides', () => {
  it('phase 01 resumeId surfaces as `resume`', () => {
    const opts = buildQueryOptions('standard', STD_INPUTS, { resumeId: 'conv_abc123' });
    expect(opts.resume).toBe('conv_abc123');
  });

  it('phase 04 abortSignal surfaces verbatim', () => {
    const ctrl = new AbortController();
    const opts = buildQueryOptions('standard', STD_INPUTS, { abortSignal: ctrl.signal });
    expect(opts.abortSignal).toBe(ctrl.signal);
  });

  it('empty overrides == no overrides', () => {
    const a = buildQueryOptions('standard', STD_INPUTS);
    const b = buildQueryOptions('standard', STD_INPUTS, {});
    expect(a).toEqual(b);
  });
});

describe('buildQueryOptions — research-safe preset', () => {
  it('is callable today (placeholder for phase 06)', () => {
    const opts = buildQueryOptions('research-safe', STD_INPUTS);
    // Today it must not silently differ from standard until phase 06
    // wires research-mode behaviour.
    expect(opts.permissionMode).toBe('bypassPermissions');
    expect(opts.disallowedTools).toEqual([...DISABLED_BUILTIN_TOOLS]);
  });
});

describe('buildQueryOptions — exhaustive preset guard', () => {
  it('throws on unknown preset (closed enum)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => buildQueryOptions('does-not-exist' as any, STD_INPUTS)).toThrow(
      /Unknown query-options preset/,
    );
  });
});
