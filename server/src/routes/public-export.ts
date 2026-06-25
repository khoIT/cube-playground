/**
 * Public segment-export API — `/api/public/v1/*`.
 *
 * The ONLY documented external surface. Authorized by an API key (NOT the FE
 * app-JWT / workspace header), scoped per key. Three endpoints:
 *   GET /segments               — list segments visible to the key (metadata)
 *   GET /segments/:id           — one segment's metadata + freshness + pull path
 *   GET /segments/:id/members   — STREAM the full cohort (NDJSON/CSV), keyset-
 *                                 paginated from Trino; resumable via ?cursor=.
 *
 * The members stream honors the completion contract: `X-Total-Count` up-front +
 * a trailing `_complete` sentinel on clean finish. A `200` is necessary but not
 * sufficient — consumers verify both (see the consumer guide / Scalar docs).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db/sqlite.js';
import { requireApiKey } from '../middleware/api-key-auth.js';
import { canKeyAccessSegment } from '../auth/api-key-scope.js';
import type { ApiKeyScope } from '../auth/api-key-store.js';
import {
  parseFields,
  resolveExportSource,
  streamExportPages,
  hasSnapshotPartition,
  UnknownFieldError,
  type ExportFormat,
  AVAILABLE_FIELDS,
} from '../services/segment-export-stream.js';
import { toPublicSegment, toPublicSegmentDetail } from '../services/public-segment-dto.js';
import { acquireExportSlot, RateLimitRejected } from '../services/api-key-rate-limiter.js';
import {
  openPullAudit,
  setPullAuditSource,
  finalizePullAudit,
} from '../auth/public-pull-audit.js';

const PREFIX = '/api/public/v1';

interface SegmentRow {
  id: string;
  name: string;
  game_id: string;
  workspace: string;
  uid_count: number;
  status: string;
  last_refreshed_at: string | null;
  type: string;
  cube: string | null;
  cube_query_json: string | null;
}

const TAG = 'public';

/** Write a chunk to the raw socket, awaiting drain on backpressure. */
function writeChunk(raw: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = raw.write(text, (err) => {
      if (err) reject(err);
    });
    if (ok) resolve();
    else raw.once('drain', resolve);
  });
}

export default async function publicExportRoutes(app: FastifyInstance): Promise<void> {
  // Surface-wide API-key auth — NOT the FE app-JWT/workspace middleware.
  app.addHook('preHandler', requireApiKey);

  // --- GET /segments — scoped metadata list ---------------------------------
  app.get(
    `${PREFIX}/segments`,
    {
      schema: {
        tags: [TAG],
        summary: 'List segments visible to this API key',
        security: [{ apiKey: [] }],
        querystring: {
          type: 'object',
          properties: {
            cursor: { type: 'string', description: 'Resume after this segment id' },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const scope = req.apiKeyScope as ApiKeyScope;
      const { cursor, limit } = req.query as { cursor?: string; limit?: number };
      const cap = Math.min(Number(limit) || 100, 500);

      // Push the FULL scope (workspace + segment/game allowlists) into SQL so the
      // keyset page and the authorization filter agree. If the allowlist were
      // applied only in JS after a workspace-only SQL page, a sparse allowlist
      // could empty the page and null the cursor prematurely — silently dropping
      // in-scope segments beyond the keyset boundary.
      const clauses: string[] = ['workspace = ?'];
      const params: unknown[] = [scope.workspace];
      if (cursor) {
        clauses.push('id > ?');
        params.push(cursor);
      }
      if (scope.segmentIds !== null) {
        if (scope.segmentIds.length === 0) return { segments: [], next_cursor: null };
        clauses.push(`id IN (${scope.segmentIds.map(() => '?').join(',')})`);
        params.push(...scope.segmentIds);
      }
      if (scope.gameIds !== null) {
        if (scope.gameIds.length === 0) return { segments: [], next_cursor: null };
        clauses.push(`game_id IN (${scope.gameIds.map(() => '?').join(',')})`);
        params.push(...scope.gameIds);
      }
      params.push(cap + 1);

      const rows = getDb()
        .prepare(
          `SELECT id, name, game_id, workspace, uid_count, status, last_refreshed_at, type
             FROM segments WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT ?`,
        )
        .all(...params) as SegmentRow[];

      // SQL already enforces scope; the JS check is a redundant fail-closed
      // assertion (a no-op unless SQL and scope ever drift).
      const inScope = rows.filter((r) => canKeyAccessSegment(scope, r));
      const page = inScope.slice(0, cap);
      const next = inScope.length > cap ? page[page.length - 1]?.id ?? null : null;
      return {
        segments: page.map(toPublicSegment),
        next_cursor: next,
      };
    },
  );

  // --- GET /segments/:id — one segment's metadata ---------------------------
  app.get(
    `${PREFIX}/segments/:id`,
    {
      schema: {
        tags: [TAG],
        summary: "One segment's metadata, freshness, and pull path",
        security: [{ apiKey: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const scope = req.apiKeyScope as ApiKeyScope;
      const { id } = req.params as { id: string };
      const row = loadScopedSegment(scope, id);
      if (!row) return reply.status(404).send(notFound());

      const snapshotPartitionExists = await hasSnapshotPartition(row).catch(() => false);
      return toPublicSegmentDetail(row, { snapshotPartitionExists });
    },
  );

  // --- GET /segments/:id/members — STREAM the full cohort -------------------
  app.get(
    `${PREFIX}/segments/:id/members`,
    {
      schema: {
        tags: [TAG],
        summary: 'Stream the full cohort (NDJSON default, or CSV)',
        description:
          'Streams every uid in the cohort, keyset-paginated from the warehouse. ' +
          'COMPLETION CONTRACT (required): a 200 cannot be downgraded mid-stream, so a ' +
          'truncated pull looks like a clean one. Verify BOTH (a) rows received == ' +
          'X-Total-Count, and (b) the trailing sentinel line — NDJSON {"_complete":true,' +
          '"count":N} or CSV "# complete,N" — before trusting the data. On mismatch, ' +
          'discard and resume with ?cursor=<last uid received>. Field set grows within ' +
          'v1 (additive); tolerate unknown fields.',
        security: [{ apiKey: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        querystring: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['ndjson', 'csv'], default: 'ndjson' },
            cursor: { type: 'string', description: 'Resume after this uid' },
            limit: { type: 'integer', minimum: 1, description: 'Cap rows (testing)' },
            fields: {
              type: 'string',
              description: `Comma-separated columns. Default uid. Allowed: ${AVAILABLE_FIELDS.join(', ')}`,
            },
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const scope = req.apiKeyScope as ApiKeyScope;
      const { id } = req.params as { id: string };
      const q = req.query as { format?: string; cursor?: string; limit?: number; fields?: string };

      const row = loadScopedSegment(scope, id);
      if (!row) return reply.status(404).send(notFound());

      let fields;
      try {
        fields = parseFields(q.fields);
      } catch (err) {
        if (err instanceof UnknownFieldError) {
          return reply.status(400).send({
            error: { code: 'BAD_FIELDS', message: err.message, allowed: [...AVAILABLE_FIELDS] },
          });
        }
        throw err;
      }
      const format: ExportFormat = q.format === 'csv' ? 'csv' : 'ndjson';
      const cursor = q.cursor ?? null;
      const limit = q.limit ? Number(q.limit) : null;

      // Resolve the source BEFORE hijacking so "nothing to export" becomes a
      // clean pre-stream error (not a half-written 200).
      let source;
      try {
        source = await resolveExportSource(row, fields);
      } catch (err) {
        return reply.status(422).send({
          error: { code: 'NO_SOURCE', message: (err as Error).message },
        });
      }

      // Rate limit (per-key concurrency + daily quota).
      let release: () => void;
      try {
        release = acquireExportSlot(scope.id);
      } catch (err) {
        if (err instanceof RateLimitRejected) {
          return reply
            .status(429)
            .header('Retry-After', String(err.retryAfterSec))
            .send({ error: { code: 'RATE_LIMITED', message: err.message, reason: err.reason } });
        }
        throw err;
      }

      const auditId = openPullAudit({
        keyId: scope.id,
        segmentId: row.id,
        format,
        clientIp: req.ip,
      });
      setPullAuditSource(auditId, source.path);

      const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson';

      const abort = new AbortController();
      // Listen on reply.raw (not request.raw) — request.raw 'close' fires on
      // hijack and would abort immediately. Mirrors the chat.ts streaming route.
      reply.raw.on('close', () => abort.abort());

      void reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        // Up-front cross-check half of the completion contract (segment size).
        'X-Total-Count': String(row.uid_count),
      });

      let rowsStreamed = 0;
      let sawSentinel = false;
      try {
        for await (const chunk of streamExportPages(source, { format, fields, cursor, limit, signal: abort.signal })) {
          await writeChunk(reply.raw, chunk.text);
          rowsStreamed += chunk.rowsInChunk;
          if (chunk.sentinel) sawSentinel = true;
        }
        reply.raw.end();
        finalizePullAudit(auditId, rowsStreamed, sawSentinel ? 'complete' : 'aborted');
      } catch (err) {
        // Headers already sent — cannot change status. Tear down the socket so
        // the consumer sees an abrupt close (and NO sentinel = truncated).
        const aborted = abort.signal.aborted;
        finalizePullAudit(auditId, rowsStreamed, aborted ? 'aborted' : 'error');
        if (!aborted) req.log.warn(`[public-export] stream error: ${(err as Error).message}`);
        reply.raw.destroy();
      } finally {
        release();
      }
    },
  );
}

function loadScopedSegment(scope: ApiKeyScope, id: string): SegmentRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, game_id, workspace, uid_count, status, last_refreshed_at, type, cube, cube_query_json
         FROM segments WHERE id = ?`,
    )
    .get(id) as SegmentRow | undefined;
  if (!row) return null;
  // Fail-closed: a key never even confirms the existence of an out-of-scope id.
  if (!canKeyAccessSegment(scope, row)) return null;
  return row;
}

function notFound() {
  return { error: { code: 'NOT_FOUND', message: 'Segment not found or not visible to this key.' } };
}
