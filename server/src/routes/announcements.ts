/**
 * What's New announcement read-state API.
 *
 *   GET  /api/announcements/reads  — ids of announcements the caller has read
 *   POST /api/announcements/reads  — mark a batch of announcement ids read
 *
 * Per-user, keyed on `req.owner` (the same owner identity the saved-analyses and
 * artifact-sweep routes use). Announcements are broadcast — their content is
 * bundled markdown in the frontend — so this route never sees a title or body;
 * it only tracks receipts. The client computes unread as (bundled ids − readIds).
 *
 * Not admin-gated: every authenticated user has a What's New inbox. "Mark all
 * read" is just a POST carrying every bundled id, so there is no separate route.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/sqlite.js';

// Bound a single request: the real inbox is a handful of entries, so a payload
// far past this is malformed or hostile, not a legitimate "mark all read".
const markReadSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).max(500),
});

function listReadIds(owner: string): string[] {
  const rows = getDb()
    .prepare('SELECT announcement_id FROM announcement_reads WHERE owner_id = ?')
    .all(owner) as Array<{ announcement_id: string }>;
  return rows.map((r) => r.announcement_id);
}

export default async function announcementsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/announcements/reads', async (req) => {
    return { readIds: listReadIds(req.owner) };
  });

  app.post('/api/announcements/reads', async (req, reply) => {
    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const insert = getDb().prepare(
      'INSERT OR IGNORE INTO announcement_reads (owner_id, announcement_id) VALUES (?, ?)',
    );
    // One statement per id inside an implicit transaction — idempotent via the
    // composite PK, so re-marking an already-read entry is a no-op.
    const tx = getDb().transaction((ids: string[]) => {
      for (const id of ids) insert.run(req.owner, id);
    });
    tx(parsed.data.ids);
    return { readIds: listReadIds(req.owner) };
  });
}
