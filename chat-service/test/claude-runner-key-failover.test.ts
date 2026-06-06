/**
 * claude-runner retries a turn on a balance-exhausted gateway key.
 *
 * Mocks the SDK so the first query() call ends with an error result carrying
 * the live gateway "credit balance is too low" text, and the second succeeds.
 * Asserts: the error never reaches the SSE stream, the second call runs under
 * the stg key, and a mid-stream balance error (tokens already yielded) is NOT
 * retried.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const BALANCE_ERROR =
  'API Error: 400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}';

const queryCalls: Array<{ env: Record<string, string> }> = [];
let scripts: Array<Array<Record<string, unknown>>> = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn((args: { options: { env: Record<string, string> } }) => {
    queryCalls.push({ env: args.options.env });
    const script = scripts[Math.min(queryCalls.length - 1, scripts.length - 1)] ?? [];
    return (async function* () {
      for (const msg of script) yield msg;
    })();
  }),
  createSdkMcpServer: vi.fn(() => ({ type: 'sdk', name: 'test', instance: new EventEmitter() })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: vi.fn((name: string, description: string, _schema: unknown, handler: any) => ({
    name, description, inputSchema: {}, handler, annotations: {}, _meta: undefined,
  })),
}));

vi.mock('../src/config.js', () => ({
  config: {
    anthropicApiKey: 'key-primary',
    anthropicApiStgKey: 'key-stg',
    anthropicApiBackupKey: '',
    anthropicKeyRetryCooldownMs: 600_000,
    anthropicBaseUrl: 'https://t',
    chatModel: 'claude-test',
    anthropicPromptCacheEnabled: true,
    chatQueryPreset: 'standard',
    chatContextSdkResumeEnabled: false,
  },
  isLangfuseEnabled: () => false,
}));

import { __resetKeyFailoverForTests } from '../src/core/anthropic-key-failover.js';

function runParams() {
  return {
    sessionId: 's1',
    turnId: 't1',
    systemPrompt: 'sys',
    allowedToolNames: [],
    message: 'hi',
    tools: [],
    toolContext: {
      ownerId: 'o',
      gameId: 'g',
      cubeToken: 'tok',
      workspace: 'local',
      sessionId: 's1',
      turnId: 't1',
      sseEmitter: new EventEmitter(),
    },
  };
}

describe('claude-runner — key failover retry', () => {
  beforeEach(() => {
    queryCalls.length = 0;
    __resetKeyFailoverForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('retries with the stg key on a first-call balance failure (live CLI shape: assistant echo + error result)', async () => {
    scripts = [
      // Attempt 1: the CLI first streams the error as a short assistant text
      // message, THEN ends with an error result (verified live).
      [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Credit balance is too low' }] } },
        { type: 'result', subtype: 'success', is_error: true, api_error_status: 400, result: 'Credit balance is too low' },
      ],
      // Attempt 2: clean turn.
      [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
        { type: 'result', subtype: 'success', result: 'answer' },
      ],
    ];

    const { run } = await import('../src/core/claude-runner.js');
    const events: Array<{ type: string; data?: { text?: string } }> = [];
    for await (const ev of run(runParams())) events.push(ev as never);

    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[0]!.env['ANTHROPIC_API_KEY']).toBe('key-primary');
    expect(queryCalls[1]!.env['ANTHROPIC_API_KEY']).toBe('key-stg');
    // Neither the error result nor the assistant error echo reaches the
    // client; the retried answer does.
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('Credit balance');
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('surfaces the error without retry when every key is drained', async () => {
    scripts = [
      [{ type: 'result', subtype: 'success', is_error: true, api_error_status: 400, result: 'Credit balance is too low' }],
      [{ type: 'result', subtype: 'success', is_error: true, api_error_status: 400, result: 'Credit balance is too low' }],
    ];

    const { run } = await import('../src/core/claude-runner.js');
    const events: Array<{ type: string }> = [];
    for await (const ev of run(runParams())) events.push(ev);

    // Two keys configured → exactly two attempts, then the error yields.
    expect(queryCalls).toHaveLength(2);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('does NOT retry when tokens already streamed (mid-stream failure)', async () => {
    scripts = [
      [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'partial…' }] } },
        { type: 'result', subtype: 'success', is_error: true, api_error_status: 400, result: 'Credit balance is too low' },
      ],
    ];

    const { run } = await import('../src/core/claude-runner.js');
    const events: Array<{ type: string }> = [];
    for await (const ev of run(runParams())) events.push(ev);

    expect(queryCalls).toHaveLength(1);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});
