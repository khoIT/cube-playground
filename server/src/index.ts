/**
 * Fastify server bootstrap.
 * Registers plugins and all route handlers, then listens on PORT (default 3004).
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import authenticate, { assertAuthConfigSafe } from './middleware/authenticate.js';
import enforceWriteRoles from './middleware/enforce-write-roles.js';
import workspaceHeader from './middleware/workspace-header.js';
import authRoutes from './routes/auth.js';
import adminAccessRoutes from './routes/admin-access.js';
import internalAccessRoutes from './routes/internal-access.js';
import workspacesRoutes from './routes/workspaces.js';
import artifactSweepRoutes from './routes/artifact-sweep.js';
import cubeProxyRoutes from './routes/cube-proxy.js';
import userPrefsRoutes from './routes/user-prefs.js';
import cubeAliasesRoutes from './routes/cube-aliases.js';
import segmentsRoutes from './routes/segments.js';
import segmentMember360Routes from './routes/segment-member360.js';
import segmentBriefRoutes from './routes/segment-brief.js';
import analysesRoutes from './routes/analyses.js';
import identityMapRoutes from './routes/identity-map.js';
import presetsRoutes from './routes/presets.js';
import metaVersionRoutes from './routes/meta-version.js';
import previewRoutes from './routes/preview.js';
import gamesRoutes from './routes/games.js';
import cubeTokenRoutes from './routes/cube-token.js';
import cdpMetricsRoutes from './routes/cdp-metrics.js';
import businessMetricsRoutes from './routes/business-metrics.js';
import businessMetricsDriftRoutes from './routes/business-metrics-drift.js';
import anomalyStateRoutes from './routes/anomaly-state.js';
import anomaliesRoutes from './routes/anomalies.js';
import chatRoutes from './routes/chat.js';
import glossaryRoutes from './routes/glossary.js';
import conceptsRoutes from './routes/concepts.js';
import conceptPromoteRoutes from './routes/concept-promote.js';
import dashboardsRoutes from './routes/dashboards.js';
import liveopsRoutes from './routes/liveops.js';
import settingsRoutes from './routes/settings.js';
import onboardingRoutes from './routes/onboarding.js';
import activityRoutes from './routes/activity.js';
import adminActivityRoutes from './routes/admin-activity.js';
import adminCostRoutes from './routes/admin-cost.js';
import adminLlmAuthRoutes from './routes/admin-llm-auth.js';
import adminChatAuditRoutes from './routes/admin-chat-audit.js';
import carePlaybooksRoutes from './routes/care-playbooks.js';
import carePlaybooksAuthoringRoutes from './routes/care-playbooks-authoring.js';
import carePlaybookPreviewRoutes from './routes/care-playbook-preview.js';
import careDataFreshnessRoutes from './routes/care-data-freshness.js';
import careCasesRoutes from './routes/care-cases.js';
import careActivityRoutes from './routes/care-activity.js';
import careGovernanceRoutes from './routes/care-governance.js';
import preaggRunsRoutes from './routes/preagg-runs.js';
import segmentRefreshOpsRoutes from './routes/segment-refresh-ops.js';
import { getDb } from './db/sqlite.js';
import { seedBootstrapAdmins } from './auth/bootstrap-admins.js';
import { backfillLegacyDevOwner } from './auth/dev-owner-backfill.js';
import { migrateGlossarySeed } from './db/glossary-migrate.js';
import { seedEnvConnectorIntoDb } from './services/connector-bootstrap.js';
import { hydrateFromSnapshot, getSyncStatus } from './db/snapshot-store.js';
import { startCron } from './jobs/cron-runner.js';
import { startLiveopsCacheCron } from './jobs/refresh-liveops.js';
import { startDashboardTileCacheCron } from './jobs/refresh-dashboard-tiles.js';
import {
  loadAll as loadBusinessMetrics,
  startWatcher as startBusinessMetricsWatcher,
  setRegistryDir as setBusinessMetricsRegistryDir,
  seedRegistryFromBaked as seedBusinessMetricsFromBaked,
} from './services/business-metrics-loader.js';
import { startAnomalyDetector } from './jobs/anomaly-detector.js';
import { startActivityPruneCron } from './jobs/prune-activity-events.js';
import { startCareSweepPruneCron } from './jobs/prune-care-sweep-membership.js';
import { startCareAutoSweepCron } from './jobs/care-auto-sweep.js';
import { startSegmentMembershipSnapshotCron } from './jobs/snapshot-segment-membership.js';
import { registerSlowRequestLog, startEventLoopMonitor } from './services/runtime-observability.js';
import { startPreaggRunCollector } from './services/preagg-run-collector.js';

const PORT = parseInt(process.env.PORT ?? '3004', 10);

export async function buildApp() {
  // Fail closed before anything else: never let the dev auth bypass boot in prod.
  assertAuthConfigSafe();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(authenticate);
  await app.register(enforceWriteRoles);
  await app.register(workspaceHeader);

  await app.register(authRoutes);
  await app.register(adminAccessRoutes);
  await app.register(internalAccessRoutes);
  await app.register(workspacesRoutes);
  await app.register(artifactSweepRoutes);
  await app.register(cubeProxyRoutes);
  await app.register(userPrefsRoutes);
  await app.register(cubeAliasesRoutes);
  await app.register(segmentsRoutes);
  await app.register(segmentMember360Routes);
  await app.register(segmentBriefRoutes);
  await app.register(analysesRoutes);
  await app.register(identityMapRoutes);
  await app.register(presetsRoutes);
  await app.register(metaVersionRoutes);
  await app.register(previewRoutes);
  await app.register(gamesRoutes);
  await app.register(cubeTokenRoutes);
  await app.register(cdpMetricsRoutes);
  await app.register(businessMetricsRoutes);
  await app.register(businessMetricsDriftRoutes);
  await app.register(anomalyStateRoutes);
  await app.register(anomaliesRoutes);
  await app.register(chatRoutes);
  await app.register(glossaryRoutes);
  await app.register(conceptsRoutes);
  await app.register(conceptPromoteRoutes);
  await app.register(dashboardsRoutes);
  await app.register(liveopsRoutes);
  await app.register(settingsRoutes);
  await app.register(onboardingRoutes);
  await app.register(activityRoutes);
  await app.register(adminActivityRoutes);
  await app.register(adminCostRoutes);
  await app.register(adminLlmAuthRoutes);
  await app.register(adminChatAuditRoutes);
  await app.register(carePlaybooksRoutes);
  await app.register(carePlaybooksAuthoringRoutes);
  await app.register(carePlaybookPreviewRoutes);
  await app.register(careDataFreshnessRoutes);
  await app.register(careCasesRoutes);
  await app.register(careActivityRoutes);
  await app.register(careGovernanceRoutes);
  await app.register(preaggRunsRoutes);
  await app.register(segmentRefreshOpsRoutes);

  // Bootstrap-admin seed (cutover safety): ensure AUTH_BOOTSTRAP_ADMINS resolve
  // as active admins so DB-authoritative authz never locks every operator out.
  try {
    getDb(); // ensure migrations (incl. 019 auth grants) have run
    const seeded = seedBootstrapAdmins();
    if (seeded.length > 0) app.log.info(`[auth] bootstrap admins seeded: ${seeded.length}`);
  } catch (err) {
    app.log.warn(`[auth] bootstrap-admin seed failed: ${(err as Error).message}`);
  }

  // AUTH_DISABLED only: rewrite legacy 'dev'-owned rows to the dev-admin owner
  // sub so pre-rename local data stays reachable under the real identity.
  try {
    const backfilled = backfillLegacyDevOwner();
    const tables = Object.keys(backfilled);
    if (tables.length > 0) {
      app.log.info({ backfilled }, `[auth] legacy 'dev' owner rows rewritten in: ${tables.join(', ')}`);
    }
  } catch (err) {
    app.log.warn(`[auth] dev-owner backfill failed: ${(err as Error).message}`);
  }

  // Phase-03: idempotent seed of the canonical glossary terms.
  try {
    const result = migrateGlossarySeed(getDb());
    app.log.info(
      `[glossary] seeded ${result.upserted} term(s); purged ${result.purged} orphan(s)`,
    );
  } catch (err) {
    app.log.warn(`[glossary] seed failed: ${(err as Error).message}`);
  }

  // Materialize the env-only Trino connector into an editable DB row (vault-key
  // guarded; idempotent). Degrades to the read-only env seed when no vault key.
  try {
    const seed = seedEnvConnectorIntoDb();
    app.log.info(`[connectors] bootstrap-seed: ${seed.reason}`);
  } catch (err) {
    app.log.warn(`[connectors] bootstrap-seed failed: ${(err as Error).message}`);
  }

  // Business-metrics registry: in prod the YAMLs live on the persisted /data
  // volume (BUSINESS_METRICS_DIR) so metrics created/scaffolded at runtime
  // survive redeploys. Seed it from the image-baked presets (per-file
  // copy-if-missing) before loading. Unset → registry stays at the baked dir
  // (dev), and the seed step is a no-op.
  const bmDir = process.env.BUSINESS_METRICS_DIR;
  if (bmDir) {
    setBusinessMetricsRegistryDir(bmDir);
    const seeded = await seedBusinessMetricsFromBaked({ warn: app.log.warn.bind(app.log) });
    app.log.info(`[business-metrics] registry dir=${bmDir}; seeded ${seeded.copied} baked metric(s)`);
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

  // Warn-log slow requests so stalls are greppable in logs/dev-all.log.
  registerSlowRequestLog(app);

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
    if (process.env.NODE_ENV !== 'test') {
      startCron();
      startLiveopsCacheCron();
      startDashboardTileCacheCron();
      startActivityPruneCron();
      startCareSweepPruneCron();
      startCareAutoSweepCron();
      // Lakehouse daily segment-membership snapshot — only fires when
      // SEGMENT_SNAPSHOT_ENABLED=true (writes to shared Trino; opt-in per env).
      startSegmentMembershipSnapshotCron();
    }
    // Phase 2: SQLite anomaly detector — gated by ANOMALY_DETECTOR_ENABLED=true
    startAnomalyDetector((msg) => app.log.warn(msg));
    // Pre-agg run history collector — gated by PREAGG_COLLECTOR_ENABLED=true.
    // Reads worker logs via Docker socket (read-only mount) and persists sweep
    // outcomes to SQLite. Degrades gracefully when the socket is absent.
    startPreaggRunCollector();
    // Sample event-loop delay; warns when synchronous work starves the loop.
    startEventLoopMonitor(app.log);
    app.log.info(`Server ready in ${Date.now() - start}ms on :${PORT}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
