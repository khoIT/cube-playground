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
import cubeTokenRoutes from './routes/cube-token.js';
import cdpMetricsRoutes from './routes/cdp-metrics.js';
import businessMetricsRoutes from './routes/business-metrics.js';
import anomalyStateRoutes from './routes/anomaly-state.js';
import anomaliesRoutes from './routes/anomalies.js';
import chatRoutes from './routes/chat.js';
import glossaryRoutes from './routes/glossary.js';
import { getDb } from './db/sqlite.js';
import { migrateGlossarySeed } from './db/glossary-migrate.js';
import { hydrateFromSnapshot, getSyncStatus } from './db/snapshot-store.js';
import { startCron } from './jobs/cron-runner.js';
import {
  loadAll as loadBusinessMetrics,
  startWatcher as startBusinessMetricsWatcher,
} from './services/business-metrics-loader.js';
import { startAnomalyDetector } from './jobs/anomaly-detector.js';

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
  await app.register(cubeTokenRoutes);
  await app.register(cdpMetricsRoutes);
  await app.register(businessMetricsRoutes);
  await app.register(anomalyStateRoutes);
  await app.register(anomaliesRoutes);
  await app.register(chatRoutes);
  await app.register(glossaryRoutes);

  // Phase-03: idempotent seed of the canonical glossary terms.
  try {
    const result = migrateGlossarySeed(getDb());
    app.log.info(
      `[glossary] seeded ${result.upserted} term(s); purged ${result.purged} orphan(s)`,
    );
  } catch (err) {
    app.log.warn(`[glossary] seed failed: ${(err as Error).message}`);
  }

  // Hydrate the business-metrics cache before serving the first request.
  const bm = await loadBusinessMetrics({ warn: app.log.warn.bind(app.log) });
  app.log.info(
    `[business-metrics] loaded ${bm.loaded} metric(s); skipped ${bm.skipped.length}`,
  );
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    startBusinessMetricsWatcher((info) =>
      app.log.info(`[business-metrics] reloaded: ${info.loaded} loaded, ${info.skipped} skipped`),
    );
  }

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

  const sync = getSyncStatus();
  if (sync) {
    const tag = sync.ok ? 'OK' : 'BEHIND';
    const note = sync.local > sync.snapshot ? ` (ahead by ${sync.local - sync.snapshot})` : '';
    console.log(`[sync] segments local=${sync.local} snapshot=${sync.snapshot} ${tag}${note}`);
  }

  buildApp().then(async (app) => {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    if (process.env.NODE_ENV !== 'test') startCron();
    // Phase 2: SQLite anomaly detector — gated by ANOMALY_DETECTOR_ENABLED=true
    startAnomalyDetector((msg) => app.log.warn(msg));
    app.log.info(`Server ready in ${Date.now() - start}ms on :${PORT}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
