/**
 * E2E integration smoke for the chart flow.
 *
 * Mocks the Claude SDK so tool_use messages dispatch to the REAL tool
 * handlers (chart-spec validation, SSE emit, persistence). Verifies that:
 *   1. emit_chart standalone → SSE `chart` event with parsed spec
 *   2. emit_query_artifact with chart field → SSE `query_artifact` whose data
 *      includes a `chart` property
 *   3. Persistence: charts_json populated, artifact's chart embedded
 *   4. Hydration: GET /sessions/:id returns turns with text/createdAt/
 *      artifacts/charts in the FE-friendly shape
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';

// ---------------------------------------------------------------------------
// Tool handler registry — populated by the mocked sdkTool, invoked by query()
// ---------------------------------------------------------------------------

interface ToolHandlerEntry {
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}
const toolHandlers = new Map<string, ToolHandlerEntry>();

// Per-test driver — each test pushes the canned SDK message sequence here.
let scriptedMessages: unknown[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mockTool(name: string, description: string, _schema: unknown, handler: any) {
    toolHandlers.set(name, { handler });
    return { name, description, inputSchema: {}, handler, annotations: {}, _meta: undefined };
  }

  async function* mockQuery() {
    for (const msg of scriptedMessages) {
      // If this is a tool_use, ALSO invoke the real handler so the side effect
      // (sseEmitter.emit) runs before we yield the matching tool_result.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = msg as any;
      if (m?.type === 'assistant' && m.message?.content?.[0]?.type === 'tool_use') {
        yield msg;
        const tu = m.message.content[0];
        const entry = toolHandlers.get(tu.name);
        if (entry) {
          // Await the handler so its sseEmitter side-effects fire before the
          // matching tool_result message is yielded next.
          await entry.handler(tu.input);
        }
        continue;
      }
      yield msg;
    }
  }

  return {
    query: vi.fn(() => mockQuery()),
    createSdkMcpServer: vi.fn(() => ({
      type: 'sdk',
      name: 'test',
      instance: new EventEmitter(),
    })),
    tool: vi.fn(mockTool),
  };
});

vi.mock('../src/config.js', () => ({
  config: {
    port: 3005,
    logLevel: 'silent',
    anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://test.example',
    chatModel: 'claude-test',
    chatMaxOutputTokens: 4096,
    serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000',
    chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40,
    chatMaxTokensPerTurn: 8000,
  },
}));

// Mock cube-meta-cache so emit_query_artifact's member validation passes.
vi.mock('../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn().mockResolvedValue({}),
  extractMemberNames: vi.fn(() => new Set(['Revenue.total', 'Revenue.recharge_date', 'Revenue.payment_channel'])),
  invalidate: vi.fn(),
}));

import Fastify from 'fastify';
import healthRoutes from '../src/api/health.js';
import sessionsRoutes from '../src/api/sessions.js';
import turnRoutes from '../src/api/turn.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildTestApp() {
  const fastify = Fastify({ logger: false });
  const db = makeDb();
  await fastify.register(healthRoutes, { db });
  await fastify.register(sessionsRoutes, { db });
  await fastify.register(turnRoutes, { db });
  await fastify.ready();
  return { fastify, db };
}

interface ParsedSseEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

function parseSseEvents(body: string): ParsedSseEvent[] {
  const out: ParsedSseEvent[] = [];
  for (const block of body.split('\n\n').filter(Boolean)) {
    let type = '';
    let raw = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) type = line.slice(7);
      if (line.startsWith('data: ')) raw = line.slice(6);
    }
    if (!type) continue;
    let data: unknown = {};
    try { data = JSON.parse(raw); } catch { data = raw; }
    out.push({ type, data });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('chart flow integration', () => {
  let fastify: ReturnType<typeof Fastify>;
  let db: Database.Database;

  beforeAll(async () => {
    const app = await buildTestApp();
    fastify = app.fastify;
    db = app.db;
  });

  afterAll(async () => {
    await fastify.close();
    db.close();
  });

  it('emit_chart standalone → chart SSE event with truncation flag', async () => {
    scriptedMessages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu_chart_1',
              name: 'emit_chart',
              input: {
                spec: {
                  type: 'pie',
                  title: 'Web vs IAP',
                  data: [
                    { group: 'Web', revenue: 3450 },
                    { group: 'IAP', revenue: 1810 },
                  ],
                  encoding: { category: 'group', value: 'revenue' },
                },
              },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_chart_1',
              content: [{ type: 'text', text: '{"ok":true,"id":"c-1","truncated":false}' }],
            },
          ],
        },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
      {
        type: 'result',
        result: 'Done.',
        total_cost_usd: 0.001,
        usage: { input_tokens: 50, output_tokens: 30 },
      },
    ];

    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-token': 'Bearer t',
        'x-cube-game': 'ptg',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: 'owner1',
        game: 'ptg',
        message: 'Total revenue this month split by IAP vs Web payment channel',
      }),
    });

    expect(response.statusCode).toBe(200);
    const events = parseSseEvents(response.body);
    const chartEvent = events.find((e) => e.type === 'chart');
    expect(chartEvent).toBeDefined();
    expect(chartEvent!.data.spec.type).toBe('pie');
    expect(chartEvent!.data.spec.data).toHaveLength(2);
    expect(chartEvent!.data.truncated).toBe(false);
    expect(chartEvent!.data.id).toMatch(/^[0-9a-f-]{36}$/);

    // Persistence — fetch the session and verify charts_json populated.
    const createdEvent = events.find((e) => e.type === 'session_created');
    expect(createdEvent).toBeDefined();
    const sessionId = createdEvent!.data.id;
    const sessionRes = await fastify.inject({
      method: 'GET',
      url: `/sessions/${sessionId}`,
      headers: { 'x-owner-id': 'owner1' },
    });
    expect(sessionRes.statusCode).toBe(200);
    const body = JSON.parse(sessionRes.body);
    const assistantTurn = body.turns.find((t: { role: string }) => t.role === 'assistant');
    expect(assistantTurn).toBeDefined();
    // DTO transform present
    expect(assistantTurn.text).toBe('Done.');
    expect(typeof assistantTurn.createdAt).toBe('string');
    expect(assistantTurn.charts).toHaveLength(1);
    expect(assistantTurn.charts[0].spec.type).toBe('pie');
  });

  it('emit_query_artifact with chart → query_artifact event includes embedded chart', async () => {
    scriptedMessages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu_art_1',
              name: 'emit_query_artifact',
              input: {
                title: 'Revenue by channel',
                summary: 'May 2026 revenue split by payment channel',
                query: {
                  measures: ['Revenue.total'],
                  dimensions: ['Revenue.payment_channel'],
                },
                source: 'raw',
                chart: {
                  type: 'bar',
                  title: 'Revenue by channel',
                  data: [
                    { payment_channel: '72', revenue: 2020 },
                    { payment_channel: 'appstore', revenue: 1050 },
                    { payment_channel: 'playstore', revenue: 769 },
                  ],
                  encoding: { category: 'payment_channel', value: 'revenue' },
                },
              },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_art_1',
              content: [{ type: 'text', text: '{"ok":true}' }],
            },
          ],
        },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Top channel: 72.' }] } },
      {
        type: 'result',
        result: 'Top channel: 72.',
        total_cost_usd: 0.001,
        usage: { input_tokens: 80, output_tokens: 20 },
      },
    ];

    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-token': 'Bearer t',
        'x-cube-game': 'ptg',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: 'owner1',
        game: 'ptg',
        message: 'show revenue by channel',
      }),
    });

    expect(response.statusCode).toBe(200);
    const events = parseSseEvents(response.body);
    const artifactEvent = events.find((e) => e.type === 'query_artifact');
    expect(artifactEvent).toBeDefined();
    expect(artifactEvent!.data.chart).toBeDefined();
    expect(artifactEvent!.data.chart.spec.type).toBe('bar');
    expect(artifactEvent!.data.chart.spec.data).toHaveLength(3);
    // artifactRef should point back to the artifact id.
    expect(artifactEvent!.data.chart.artifactRef).toBe(artifactEvent!.data.id);

    // No standalone chart event when chart is embedded.
    const standaloneChartEvent = events.find((e) => e.type === 'chart');
    expect(standaloneChartEvent).toBeUndefined();
  });

  it('emit_chart with invalid spec returns ok:false and does NOT crash the turn', async () => {
    scriptedMessages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu_bad_1',
              name: 'emit_chart',
              input: {
                spec: {
                  type: 'stacked-bar',
                  title: 'Missing series',
                  data: [{ a: 'x', b: 1 }],
                  encoding: { category: 'a', value: 'b' }, // series missing
                },
              },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_bad_1',
              content: [{ type: 'text', text: '{"ok":false,"error":"invalid_spec"}' }],
            },
          ],
        },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Could not build that chart.' }] },
      },
      {
        type: 'result',
        result: 'Could not build that chart.',
        total_cost_usd: 0.001,
        usage: { input_tokens: 30, output_tokens: 10 },
      },
    ];

    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-token': 'Bearer t',
        'x-cube-game': 'ptg',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: 'owner1',
        game: 'ptg',
        message: 'broken chart please',
      }),
    });

    expect(response.statusCode).toBe(200);
    const events = parseSseEvents(response.body);
    const types = events.map((e) => e.type);
    // Turn must complete cleanly — no chart event, but done event present.
    expect(types).not.toContain('chart');
    expect(types).toContain('done');
    // No agent_error event — handler caught the bad spec gracefully.
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeUndefined();
  });

  it('emit_chart truncates > 30 rows into "Other" lump', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ region: `R${i}`, revenue: 100 - i }));
    scriptedMessages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu_big_1',
              name: 'emit_chart',
              input: {
                spec: {
                  type: 'bar',
                  title: 'Top regions',
                  data: rows,
                  encoding: { category: 'region', value: 'revenue' },
                },
              },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_big_1',
              content: [{ type: 'text', text: '{"ok":true,"truncated":true}' }],
            },
          ],
        },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Top 30 only.' }] } },
      {
        type: 'result',
        result: 'Top 30 only.',
        total_cost_usd: 0.001,
        usage: { input_tokens: 50, output_tokens: 20 },
      },
    ];

    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-token': 'Bearer t',
        'x-cube-game': 'ptg',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: 'owner1',
        game: 'ptg',
        message: 'big chart',
      }),
    });

    const events = parseSseEvents(response.body);
    const chartEvent = events.find((e) => e.type === 'chart');
    expect(chartEvent).toBeDefined();
    expect(chartEvent!.data.truncated).toBe(true);
    expect(chartEvent!.data.originalRowCount).toBe(50);
    expect(chartEvent!.data.spec.data).toHaveLength(30);
    const last = chartEvent!.data.spec.data[chartEvent!.data.spec.data.length - 1];
    expect(last.region).toBe('Other');
  });
});
