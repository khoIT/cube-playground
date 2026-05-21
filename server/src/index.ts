/**
 * Fastify server bootstrap.
 * Registers plugins and all route handlers, then listens on PORT (default 3004).
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import ownerHeader from './middleware/owner-header.js';
import segmentsRoutes from './routes/segments.js';
import analysesRoutes from './routes/analyses.js';
import identityMapRoutes from './routes/identity-map.js';
import presetsRoutes from './routes/presets.js';
import metaVersionRoutes from './routes/meta-version.js';
import previewRoutes from './routes/preview.js';
import gamesRoutes from './routes/games.js';
import { getDb } from './db/sqlite.js';
import { hydrateFromSnapshot } from './db/snapshot-store.js';
import { startCron } from './jobs/cron-runner.js';

const PORT = parseInt(process.env.PORT ?? '3004', 10);

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(ownerHeader);

  await app.register(segmentsRoutes);
  await app.register(analysesRoutes);
  await app.register(identityMapRoutes);
  await app.register(presetsRoutes);
  await app.register(metaVersionRoutes);
  await app.register(previewRoutes);
  await app.register(gamesRoutes);

  // Dev-only fixture seed endpoint for visual regression tests.
  if (process.env.NODE_ENV !== 'production') {
    const { default: fixturesRoutes } = await import('./routes/fixtures.js');
    await app.register(fixturesRoutes);
  }

  // Health check
  app.get('/api/health', async () => ({ ok: true }));

  return app;
}

// Only start the server when this file is the entry point (not imported in tests)
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain || process.env.START_SERVER === '1') {
  const start = Date.now();
  // Initialise DB (runs migrations) before accepting requests
  getDb();

  // Demo-seed: if the DB is empty, hydrate from the committed snapshot so
  // a fresh `git pull` on another machine boots with the same data + charts.
  const seed = hydrateFromSnapshot();
  if (seed.hydrated) {
    console.log('[snapshot] hydrated from seed:', seed.counts);
  }

  buildApp().then(async (app) => {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    if (process.env.NODE_ENV !== 'test') startCron();
    app.log.info(`Server ready in ${Date.now() - start}ms on :${PORT}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
