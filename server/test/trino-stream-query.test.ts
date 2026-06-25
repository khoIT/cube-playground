/**
 * Phase 02 — streamQuery generator.
 *
 * Mocks Trino's HTTP statement protocol (POST → nextUri hops) and asserts:
 *  - batches stream in order without buffering the whole result,
 *  - the first batch's columns carry forward,
 *  - an external abort cancels the in-flight hop AND fires a server-side DELETE.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamQuery } from '../src/services/trino-rest-client.js';
import type { Connector } from '../src/services/trino-profiler-config.js';

const connector: Connector = {
  id: 't',
  label: 'test',
  workspaceId: 'local',
  sourceType: 'trino',
  host: 'trino.example',
  port: 8080,
  user: 'playground',
  password: '',
  catalog: 'game_integration',
  ssl: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('streamQuery', () => {
  it('streams batches across nextUri hops in order, columns carried from first', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? 'GET' });
        if (init.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              id: 'q1',
              columns: [{ name: 'uid', type: 'varchar' }],
              data: [['a'], ['b']],
              nextUri: 'http://trino.example/v1/statement/q1/1',
            }),
          );
        }
        if (url.endsWith('/1')) {
          return Promise.resolve(
            jsonResponse({ id: 'q1', data: [['c']], nextUri: 'http://trino.example/v1/statement/q1/2' }),
          );
        }
        // last hop — no nextUri.
        return Promise.resolve(jsonResponse({ id: 'q1', data: [['d'], ['e']] }));
      }),
    );

    const seen: string[] = [];
    let columnsFromFirst: string[] = [];
    for await (const batch of streamQuery(connector, 'cfm_vn', 'SELECT uid FROM mf_users')) {
      if (columnsFromFirst.length === 0) columnsFromFirst = batch.columns.map((c) => c.name);
      for (const row of batch.rows) seen.push(String(row[0]));
    }

    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(columnsFromFirst).toEqual(['uid']);
    expect(calls[0].method).toBe('POST');
    expect(calls.filter((c) => c.method === 'GET').length).toBe(2);
  });

  it('aborts an in-flight hop and DELETEs the orphaned query', async () => {
    const controller = new AbortController();
    let deleteHit: string | null = null;

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        if (init.method === 'DELETE') {
          deleteHit = url;
          return Promise.resolve(jsonResponse({}));
        }
        if (init.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              id: 'q1',
              columns: [{ name: 'uid', type: 'varchar' }],
              data: [['a']],
              nextUri: 'http://trino.example/v1/statement/q1/1',
            }),
          );
        }
        // GET hop hangs until the external signal aborts, then rejects like fetch does.
        return new Promise((_resolve, reject) => {
          const sig = init.signal as AbortSignal;
          sig.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }),
    );

    const gen = streamQuery(connector, 'cfm_vn', 'SELECT uid FROM mf_users', {
      signal: controller.signal,
    });

    const first = await gen.next();
    expect(first.value?.rows).toEqual([['a']]);

    // Now the generator is mid GET hop; abort and expect the iteration to throw.
    const pending = gen.next();
    controller.abort();
    await expect(pending).rejects.toThrow();

    // Best-effort cancel must have fired against the last nextUri.
    expect(deleteHit).toBe('http://trino.example/v1/statement/q1/1');
  });
});
