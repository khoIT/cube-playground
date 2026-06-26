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
import {
  readPage,
  NoSnapshotError,
  InvalidPageTokenError,
  type RowQueryFn,
} from '../services/segment-page-reader.js';
import { runQuery } from '../services/trino-rest-client.js';
import { schemaForGame } from '../services/trino-profiler-config.js';
import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from '../lakehouse/lakehouse-trino-connector.js';
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
  uid_list_json: string | null;
}

const TAG = 'public';

/** Shared OpenAPI error-envelope schema. Permissive (`additionalProperties`) so
 *  the various error bodies (extra `allowed` / `hint` keys) document without the
 *  response serializer stripping them. */
function errorResponse(description: string) {
  return {
    description,
    type: 'object' as const,
    additionalProperties: true,
    properties: {
      error: {
        type: 'object' as const,
        additionalProperties: true,
        properties: { code: { type: 'string' as const }, message: { type: 'string' as const } },
      },
    },
  };
}

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
        summary: 'Pull the full cohort — stream (NDJSON/CSV) or paginated JSON',
        description:
          'Two read modes, selected by ?format=:\n\n' +
          'STREAM (format=ndjson default, or csv): streams every uid keyset-paginated ' +
          'from the warehouse, all at once. COMPLETION CONTRACT (required): a 200 cannot ' +
          'be downgraded mid-stream, so a truncated pull looks like a clean one. Verify ' +
          'BOTH (a) rows received == X-Total-Count, and (b) the trailing sentinel line — ' +
          'NDJSON {"_complete":true,"count":N} or CSV "# complete,N" — before trusting the ' +
          'data. On mismatch, discard and resume with ?cursor=<last uid received>. Field ' +
          'set grows within v1 (additive); tolerate unknown fields.\n\n' +
          'PAGINATED (format=json or csv_paged): pull the cohort one page at a time at ' +
          'your own pace. Page 1 (no page_id) pins a point-in-time snapshot. format=json ' +
          'returns { members:[uid…], page_id, has_more, total_count }; format=csv_paged ' +
          'returns a CSV body (uid header on page 1 only) with the next token + counts in ' +
          'response headers X-Next-Page-Id / X-Has-More / X-Total-Count / X-Returned-Count. ' +
          'Pass page_id back to fetch the next page; repeat until has_more=false (json: ' +
          'page_id=null; csv_paged: no X-Next-Page-Id header). A 409 means the segment has ' +
          'no snapshot yet — refresh it, then retry from page 1.',
        security: [{ apiKey: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        querystring: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['ndjson', 'csv', 'json', 'csv_paged'], default: 'ndjson' },
            cursor: { type: 'string', description: 'Stream mode: resume after this uid' },
            page_id: { type: 'string', description: 'Paged mode (json/csv_paged): opaque token for the next page' },
            limit: {
              type: 'integer',
              minimum: 1,
              description: 'Stream: cap rows (testing). JSON: page size (default 1000, max 10000).',
            },
            fields: {
              type: 'string',
              description: `Stream mode columns, comma-separated. Default uid. Allowed: ${AVAILABLE_FIELDS.join(', ')}`,
            },
          },
        },
        response: {
          200: {
            description:
              'format=json: one cohort page (this JSON shape). format=csv_paged: a CSV ' +
              'body, with the next token in the X-Next-Page-Id header. Stream formats ' +
              '(ndjson/csv) return the hijacked byte stream instead — not this shape.)',
            type: 'object',
            // Permissive so the hijacked stream 200 and the JSON page 200 share one
            // entry without the serializer stripping either.
            additionalProperties: true,
            properties: {
              segment_id: { type: 'string' },
              total_count: { type: 'integer', description: 'Server-side cohort size; constant across pages' },
              returned_count: { type: 'integer' },
              members: { type: 'array', items: { type: 'string' }, description: 'uids for this page' },
              page_id: { type: 'string', nullable: true, description: 'Pass back for the next page; null when exhausted' },
              has_more: { type: 'boolean' },
            },
          },
          400: errorResponse('Invalid request — bad ?fields= (BAD_FIELDS) or page_id (INVALID_PAGE_ID).'),
          404: errorResponse('Segment not found or not visible to this key.'),
          409: errorResponse('No snapshot yet for this predicate segment (NO_SNAPSHOT) — refresh, then retry from page 1.'),
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const scope = req.apiKeyScope as ApiKeyScope;
      const { id } = req.params as { id: string };
      const q = req.query as {
        format?: string;
        cursor?: string;
        page_id?: string;
        limit?: number;
        fields?: string;
      };

      const row = loadScopedSegment(scope, id);
      if (!row) return reply.status(404).send(notFound());

      // Paginated mode — discrete pages with an opaque page_id, additive to the
      // NDJSON/CSV stream below. Plain reply (no hijack): JSON body, or a CSV body
      // with the next token in response headers.
      if (q.format === 'json' || q.format === 'csv_paged') {
        return handleMembersPage(row, q, reply, q.format === 'csv_paged' ? 'csv' : 'json');
      }

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
      // A full-cohort stream is a download, not a previewable doc — name it so
      // clients save `segment-<id>.ndjson|csv` instead of `response.unknown`.
      const ext = format === 'csv' ? 'csv' : 'ndjson';
      const filename = `segment-${row.id}.${ext}`;

      const abort = new AbortController();
      // Listen on reply.raw (not request.raw) — request.raw 'close' fires on
      // hijack and would abort immediately. Mirrors the chat.ts streaming route.
      reply.raw.on('close', () => abort.abort());

      void reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
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

/**
 * Serve one page of a segment's cohort, uid-only (the stream path covers enriched
 * export). Two outputs over the SAME paged reader:
 *   'json' → body { segment_id, total_count, returned_count, members, page_id, has_more }
 *   'csv'  → CSV body (uid header on page 1 only); the next token + counts ride in
 *            response headers (X-Next-Page-Id / X-Has-More / X-Total-Count /
 *            X-Returned-Count) since a flat CSV has no field to carry them.
 * The lakehouse query is built lazily so manual segments and a bad page_id never
 * construct a warehouse connector. Reader errors map to:
 *   InvalidPageTokenError → 400   (malformed / wrong-segment page_id)
 *   NoSnapshotError       → 409   (predicate segment with no snapshot yet)
 */
async function handleMembersPage(
  row: SegmentRow,
  q: { page_id?: string; limit?: number },
  reply: FastifyReply,
  output: 'json' | 'csv',
): Promise<FastifyReply> {
  const query: RowQueryFn = (sql) => {
    const connector = lakehouseConnectorFromEnv();
    const schema = schemaForGame(row.game_id) ?? '';
    return runQuery(connector, schema, sql, LAKEHOUSE_STATEMENT_TIMEOUT_MS).then((r) => r.rows);
  };

  try {
    const page = await readPage(
      { segment: row, limit: q.limit ? Number(q.limit) : undefined, pageId: q.page_id },
      query,
    );
    if (output === 'csv') {
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('X-Total-Count', String(page.total_count))
        .header('X-Returned-Count', String(page.uids.length))
        .header('X-Has-More', String(page.has_more));
      // Absence of X-Next-Page-Id is the "last page" signal (mirrors page_id=null).
      if (page.next_page_id) reply.header('X-Next-Page-Id', page.next_page_id);
      // Header row only on page 1 (no incoming token), so concatenated pages form
      // one valid CSV. uids are warehouse-sourced strings — escape defensively.
      const header = q.page_id ? '' : 'uid\n';
      const body = page.uids.map(csvCell).join('\n');
      return reply.status(200).send(header + body + (page.uids.length ? '\n' : ''));
    }
    return reply.status(200).send({
      segment_id: row.id,
      total_count: page.total_count,
      returned_count: page.uids.length,
      members: page.uids,
      page_id: page.next_page_id,
      has_more: page.has_more,
    });
  } catch (err) {
    if (err instanceof InvalidPageTokenError) {
      return reply.status(400).send({ error: { code: 'INVALID_PAGE_ID', message: err.message } });
    }
    if (err instanceof NoSnapshotError) {
      return reply.status(409).send({
        error: { code: 'NO_SNAPSHOT', message: err.message, hint: 'refresh the segment, then retry' },
      });
    }
    throw err;
  }
}

/** RFC-4180 CSV cell: quote + double inner quotes when the value has a comma,
 *  quote, or newline. uids don't need it, but warehouse strings are escaped to
 *  stay injection/format-safe by construction. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function loadScopedSegment(scope: ApiKeyScope, id: string): SegmentRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, game_id, workspace, uid_count, status, last_refreshed_at, type, cube, cube_query_json, uid_list_json
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
