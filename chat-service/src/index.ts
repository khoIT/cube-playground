/**
 * chat-service entry point.
 * Boots Fastify on PORT, runs SQLite migrations, registers routes.
 *
 * `boot-guard` MUST be the first import — it installs synchronous-write
 * crash handlers before any other module is evaluated, so failures in
 * config.ts validation (e.g. missing ANTHROPIC_API_KEY) or app.listen()
 * (e.g. EADDRINUSE) surface in the terminal instead of being lost in the
 * concurrently/tsx-watch pipe on Windows.
 */

import './boot-guard.js';
import 'dotenv/config';
import Fastify from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { validateSkillRegistry } from './core/registry-boot-guard.js';
import { openDatabase } from './db/migrate.js';
import { hydrateChatFromSnapshot, getChatSyncStatus } from './db/snapshot-store.js';
import healthRoutes from './api/health.js';
import sessionsRoutes from './api/sessions.js';
import turnRoutes from './api/turn.js';
import replayRoutes from './api/replay.js';
import statsRoutes from './api/stats.js';
import auditRoutes from './api/audit.js';
import debugRoutes from './api/debug.js';
import debugAnnotationRoutes from './api/debug-annotations.js';
import debugSearchRoutes from './api/debug-search.js';
import debugSearchCachedRoutes from './api/debug-search-cached.js';
import debugLeaderboardRoutes from './api/debug-leaderboard.js';
import debugCacheClearRoutes from './api/debug-cache-clear.js';
import debugCacheEffectivenessRoutes from './api/debug-cache-effectiveness.js';
import notificationsRoutes from './api/notifications.js';
import chatUserPrefsRoutes from './api/chat-user-prefs.js';
import { scheduler } from './services/scheduler.js';
import { registerRetentionSweep } from './services/retention-sweep.js';
import { registerResponseCacheSweep } from './services/response-cache-sweep.js';
import { RateLimiter, buildRateLimitHook } from './middleware/rate-limit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(__dirname, '../runtime');
const CLAUDE_HOME = resolve(RUNTIME_DIR, 'claude-home/.claude');

async function seedClaudeHome(): Promise<void> {
  await mkdir(CLAUDE_HOME, { recursive: true });
  const settingsPath = resolve(CLAUDE_HOME, 'settings.json');
  if (!existsSync(settingsPath)) {
    await writeFile(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
  }
}

async function buildApp(dbPath?: string) {
  const fastify = Fastify({ logger: { level: config.logLevel } });

  const db = openDatabase(dbPath ?? config.chatDbPath);

  // Rate limiter — applied only to POST /agent/turn via the hook
  const limiter = new RateLimiter({
    capacity: config.rateLimitPerOwnerPerMin,
    refillPerMin: config.rateLimitPerOwnerPerMin,
  });
  fastify.addHook('onRequest', buildRateLimitHook(limiter));

  await fastify.register(healthRoutes, { db });
  await fastify.register(sessionsRoutes, { db });
  await fastify.register(turnRoutes, { db });
  await fastify.register(replayRoutes, { db });
  await fastify.register(statsRoutes, { db });
  await fastify.register(auditRoutes, { db });
  await fastify.register(debugRoutes, { db });
  await fastify.register(debugAnnotationRoutes, { db });
  await fastify.register(debugSearchRoutes, { db });
  await fastify.register(debugSearchCachedRoutes, { db });
  await fastify.register(debugLeaderboardRoutes, { db });
  await fastify.register(debugCacheClearRoutes, { db });
  await fastify.register(debugCacheEffectivenessRoutes, { db });
  await fastify.register(notificationsRoutes, { db });
  await fastify.register(chatUserPrefsRoutes, { db });

  return { fastify, db };
}

async function start(): Promise<void> {
  await seedClaudeHome();

  // Fail fast on SKILL.md typos — better to crash at boot than silently
  // degrade to "skill falls back to explore" in prod.
  const skillCheck = validateSkillRegistry();

  const { fastify, db } = await buildApp();
  fastify.log.info(
    skillCheck,
    '[boot-guard] skill registry validation OK',
  );
  const seeded = hydrateChatFromSnapshot(db);
  if (seeded.hydrated) {
    fastify.log.info({ counts: seeded.counts }, '[chat-snapshot] hydrated from seed');
  }

  const sync = getChatSyncStatus(db);
  if (sync) {
    const fmt = (label: string, s: { local: number; snapshot: number; ok: boolean }) => {
      const tag = s.ok ? 'OK' : 'BEHIND';
      const note = s.local > s.snapshot ? ` (ahead by ${s.local - s.snapshot})` : '';
      fastify.log.info(`[sync] ${label} local=${s.local} snapshot=${s.snapshot} ${tag}${note}`);
    };
    fmt('chat-sessions', sync.sessions);
    fmt('chat-turns', sync.turns);
  }

  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`chat-service listening on port ${config.port}`);

  // Register retention sweep before scheduler.start() so the catch-up sweep
  // runs synchronously on boot (purges sessions that aged out while offline).
  registerRetentionSweep(db);
  // Phase-06: response cache 24h sweep — catch-up on boot, then hourly.
  registerResponseCacheSweep(db);

  // Phase-05: start any registered cron jobs after the server is up so the
  // health/notifications endpoints are reachable before first tick.
  scheduler.start();
  fastify.log.info(
    { jobs: scheduler.list().map((j) => j.name) },
    '[scheduler] started',
  );
}

// Allow other modules (tests) to import buildApp without starting the server
export { buildApp };

// Start only when this file is the entry point. Tests import { buildApp }
// from here and use fastify.inject() — they must NOT trigger a real listen,
// because (a) a long-running chat-service may already hold :3005 in dev,
// and (b) boot-guard's unhandledRejection handler would call process.exit
// on the resulting EADDRINUSE, which vitest workers surface as a fatal.
// Mirrors the gate used by server/src/index.ts.
const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain || process.env.START_SERVER === '1') {
  start();
}
