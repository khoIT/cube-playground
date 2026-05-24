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
import { openDatabase } from './db/migrate.js';
import { hydrateChatFromSnapshot, getChatSyncStatus } from './db/snapshot-store.js';
import healthRoutes from './api/health.js';
import sessionsRoutes from './api/sessions.js';
import turnRoutes from './api/turn.js';
import replayRoutes from './api/replay.js';
import statsRoutes from './api/stats.js';
import auditRoutes from './api/audit.js';
import notificationsRoutes from './api/notifications.js';
import { scheduler } from './services/scheduler.js';
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
  await fastify.register(notificationsRoutes, { db });

  return { fastify, db };
}

async function start(): Promise<void> {
  await seedClaudeHome();

  const { fastify, db } = await buildApp();
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

  // Phase-05: start any registered cron jobs after the server is up so the
  // health/notifications endpoints are reachable before first tick. Phases
  // register handlers at module-import time (or via explicit register()
  // calls) — this just flips the started flag.
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
