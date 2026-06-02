/**
 * Regression test for the x-cube-game header on every gateway call.
 *
 * Background: apiFetch centralized x-cube-workspace but left x-cube-game to
 * each call site. /api/identity-map (which drives the segment row-picker) went
 * out game-less, so on a game_id (multi-tenant) workspace the gateway minted a
 * game-less Cube token, /meta came back empty, no identity suggestions were
 * produced, and the row-picker never rendered on prod — while local (a laxer
 * cube) still showed it. Pin the header onto apiFetch so tenant scope is an
 * invariant, not per-call discipline.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const origFetch = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
});

afterEach(() => {
  global.fetch = origFetch;
  vi.restoreAllMocks();
});

function lastHeaders(): Record<string, string> {
  const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

it('attaches x-cube-game from the active game on every gateway call', async () => {
  localStorage.setItem('gds-cube:active-game', 'ballistar');
  const { apiFetch } = await import('../api-client');
  await apiFetch('/api/identity-map');
  expect(lastHeaders()['x-cube-game']).toBe('ballistar');
});

it('omits x-cube-game when no active game is stored', async () => {
  const { apiFetch } = await import('../api-client');
  await apiFetch('/api/identity-map');
  expect(lastHeaders()['x-cube-game']).toBeUndefined();
});

it('does not override an x-cube-game header set explicitly by the caller', async () => {
  localStorage.setItem('gds-cube:active-game', 'ballistar');
  const { apiFetch } = await import('../api-client');
  await apiFetch('/api/identity-map', { headers: { 'x-cube-game': 'cros' } });
  expect(lastHeaders()['x-cube-game']).toBe('cros');
});

it('attaches both workspace and game scope together', async () => {
  localStorage.setItem('gds-cube:workspace', 'local');
  localStorage.setItem('gds-cube:active-game', 'jus_vn');
  const { apiFetch } = await import('../api-client');
  await apiFetch('/api/identity-map');
  const h = lastHeaders();
  expect(h['x-cube-workspace']).toBe('local');
  expect(h['x-cube-game']).toBe('jus_vn');
});
