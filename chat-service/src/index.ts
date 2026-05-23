/**
 * chat-service entry point.
 * Boots Fastify on PORT, runs SQLite migrations, registers routes.
 */

import 'dotenv/config';
import Fastify from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { openDatabase } from './db/migrate.js';
import healthRoutes from './api/health.js';
import sessionsRoutes from './api/sessions.js';
import turnRoutes from './api/turn.js';

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

  await fastify.register(healthRoutes, { db });
  await fastify.register(sessionsRoutes, { db });
  await fastify.register(turnRoutes, { db });

  return { fastify, db };
}

async function start(): Promise<void> {
  await seedClaudeHome();

  const { fastify } = await buildApp();

  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`chat-service listening on port ${config.port}`);
}

// Allow other modules (tests) to import buildApp without starting the server
export { buildApp };

// Start when run directly
start().catch((err) => {
  console.error('Failed to start chat-service:', err);
  process.exit(1);
});
