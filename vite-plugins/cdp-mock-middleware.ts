/**
 * cdp-mock-middleware.ts
 * Mock-only vite plugin mounted at /cdp/v1 in development. Replace with a
 * real MM-01 proxy when the upstream service is reachable + auth lands.
 *
 * Seed contract: `cdp-mock-seed.json` is loaded once on plugin init. The
 * in-memory store resets every dev-server start. Tests inject a fresh
 * `Map` via `router(store)` and exercise handlers directly.
 *
 * No Authorization header check, no 401 path — locked per the originating
 * plan's Validation Session 1.
 */

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleGetOne,
  handleGetTotal,
  handleListByGame,
  handlePost,
  internalError,
  keyOf,
  notFound,
  type MetricRecord,
  type Store,
} from './cdp-mock-handlers.js';
import seedData from './cdp-mock-seed.json' with { type: 'json' };

type Seed = { metrics: MetricRecord[] };

export function hydrateFromSeed(store: Store, seed: Seed = seedData as Seed): void {
  store.clear();
  for (const m of seed.metrics) {
    store.set(keyOf(m.game_id, m.metric_name), m);
  }
}

/**
 * Connect-style request router. Exported so handler tests can drive it with
 * synthetic req/res without spinning up vite.
 */
export function router(store: Store) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const rawUrl = req.url ?? '/';
      const url = new URL(rawUrl, 'http://internal');
      const parts = url.pathname.split('/').filter(Boolean);
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'POST' && parts.length === 1 && parts[0] === 'metrics') {
        await handlePost(req, res, store);
        return;
      }

      if (method === 'GET' && parts[0] === 'metrics') {
        if (parts.length === 2) {
          handleListByGame(res, store, parts[1], url.searchParams);
          return;
        }
        if (parts.length === 3) {
          if (parts[2] === 'total') {
            handleGetTotal(res, store, parts[1]);
            return;
          }
          handleGetOne(res, store, parts[1], decodeURIComponent(parts[2]));
          return;
        }
      }

      notFound(res);
    } catch (e) {
      if (!res.headersSent) internalError(res, e);
    }
  };
}

export function cdpMockMiddleware(): Plugin {
  const store: Store = new Map();
  return {
    name: 'cdp-mock-middleware',
    apply: 'serve',
    configureServer(server) {
      hydrateFromSeed(store);
      const handle = router(store);
      server.middlewares.use('/cdp/v1', (req, res) => {
        handle(req, res).catch((e) => {
          console.error('[cdp-mock] unhandled:', e);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ERROR', error: { code: 'INTERNAL_ERROR', message: String(e) } }));
          }
        });
      });
      console.info('[cdp-mock] mounted at /cdp/v1 — seed loaded with', store.size, 'records');
    },
  };
}
