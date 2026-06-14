/**
 * Guardrails are enforced at the harness, never the prompt: caps resolution,
 * deny-by-default tool gate, and the wall-clock timeout controller.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveCaps,
  makeCanUseTool,
  DEFAULT_CAPS,
} from '../src/advisor/agent/agent-guardrails.js';

const ENV_KEYS = ['ADVISOR_AGENT_MAX_TURNS', 'ADVISOR_AGENT_MAX_BUDGET_USD', 'ADVISOR_AGENT_TIMEOUT_MS'];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('resolveCaps', () => {
  it('uses defaults when no env / override', () => {
    expect(resolveCaps()).toEqual(DEFAULT_CAPS);
  });

  it('reads positive env values, ignoring junk', () => {
    process.env.ADVISOR_AGENT_MAX_TURNS = '5';
    process.env.ADVISOR_AGENT_MAX_BUDGET_USD = 'not-a-number';
    expect(resolveCaps().maxTurns).toBe(5);
    expect(resolveCaps().maxBudgetUsd).toBe(DEFAULT_CAPS.maxBudgetUsd);
  });

  it('override beats env', () => {
    process.env.ADVISOR_AGENT_MAX_TURNS = '5';
    expect(resolveCaps({ maxTurns: 99 }).maxTurns).toBe(99);
  });
});

describe('makeCanUseTool (deny-by-default)', () => {
  const gate = makeCanUseTool(['mcp__advisor__echo']);

  it('allows an allowlisted tool', async () => {
    const d = await gate('mcp__advisor__echo', { text: 'hi' });
    expect(d.behavior).toBe('allow');
  });

  it('denies anything not on the allowlist (incl built-ins)', async () => {
    expect((await gate('Bash', { command: 'rm -rf /' })).behavior).toBe('deny');
    expect((await gate('Read', {})).behavior).toBe('deny');
    expect((await gate('mcp__other__tool', {})).behavior).toBe('deny');
  });
});
