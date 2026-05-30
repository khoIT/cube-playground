/**
 * Per-owner user preferences (key/value).
 *
 * Scope: small UI settings that must survive device changes. Active workspace
 * is the canonical example. NOT a session store, NOT for secrets.
 *
 *   GET    /api/user-prefs/:key              → { value: string | null }
 *   PUT    /api/user-prefs/:key              → 204; body: { value: string }
 *   DELETE /api/user-prefs/:key              → 204
 *   GET    /api/user-prefs                   → { [key]: string } (all owner keys)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getDb } from '../db/sqlite.js';

// Generous ceiling: most prefs are tiny (ids, booleans), but the new-metric
// draft blob (filter trees + multi-source inputs) serializes to several KB.
// SQLite TEXT handles this trivially; the cap is purely an abuse guard.
const PUT_BODY = z.object({ value: z.string().min(0).max(200_000) });

export default async function userPrefsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/user-prefs', async (req) => {
    const rows = getDb()
      .prepare(`SELECT key, value FROM user_prefs WHERE owner = ?`)
      .all(req.owner) as Array<{ key: string; value: string }>;
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  });

  app.get<{ Params: { key: string } }>('/api/user-prefs/:key', async (req) => {
    const row = getDb()
      .prepare(`SELECT value FROM user_prefs WHERE owner = ? AND key = ?`)
      .get(req.owner, req.params.key) as { value: string } | undefined;
    return { value: row?.value ?? null };
  });

  app.put<{ Params: { key: string } }>('/api/user-prefs/:key', async (req, reply) => {
    const parsed = PUT_BODY.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: parsed.error.message },
      });
    }
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO user_prefs (owner, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(req.owner, req.params.key, parsed.data.value, now);
    return reply.status(204).send();
  });

  app.delete<{ Params: { key: string } }>('/api/user-prefs/:key', async (req, reply) => {
    getDb()
      .prepare(`DELETE FROM user_prefs WHERE owner = ? AND key = ?`)
      .run(req.owner, req.params.key);
    return reply.status(204).send();
  });
}
