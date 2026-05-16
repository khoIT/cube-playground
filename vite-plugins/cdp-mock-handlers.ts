/**
 * cdp-mock-handlers.ts
 * Pure HTTP handlers for /cdp/v1/* — extracted so cdp-mock-middleware.ts
 * stays under the 200-line ceiling and the routing logic stays unit-testable
 * without bringing up a real vite server.
 *
 * MM-01 envelope:
 *   Success: { status: 'SUCCESS', error: null, data?, pagination? }
 *   Error:   { status: 'ERROR',   error: { code, message } }
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export type MetricRecord = {
  game_id: string;
  metric_name: string;
  metric_codename: string;
  source: string;
  expression: string;
  dimensions: string[];
  filter: string;
  materialize: boolean;
  schedule: string;
  created_at: string;
  updated_at: string;
};

export type StoreKey = `${string}:${string}`;
export type Store = Map<StoreKey, MetricRecord>;

const DEFAULT_PAGE_SIZE = 50;

export function keyOf(gameId: string, metricName: string): StoreKey {
  return `${gameId}:${metricName}`;
}

function envelope(status: number, body: unknown, res: ServerResponse) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function ok(res: ServerResponse, data?: unknown, pagination?: unknown) {
  const body: Record<string, unknown> = { status: 'SUCCESS', error: null };
  if (data !== undefined) body.data = data;
  if (pagination !== undefined) body.pagination = pagination;
  envelope(200, body, res);
}

function err(res: ServerResponse, httpStatus: number, code: string, message: string) {
  envelope(httpStatus, { status: 'ERROR', error: { code, message } }, res);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.length === 0 ? null : JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function hasGame(store: Store, gameId: string): boolean {
  for (const k of store.keys()) {
    if (k.startsWith(`${gameId}:`)) return true;
  }
  return false;
}

function nowIso(): string {
  return new Date().toISOString().replace('Z', '+00:00');
}

function validatePostBody(body: unknown): { ok: true; record: MetricRecord } | { ok: false; missing: string } {
  if (!body || typeof body !== 'object') return { ok: false, missing: 'body' };
  const b = body as Record<string, unknown>;
  for (const field of ['game_id', 'metric_name', 'metric_codename', 'source', 'expression']) {
    if (typeof b[field] !== 'string' || (b[field] as string).length === 0) {
      return { ok: false, missing: field };
    }
  }
  const dims = Array.isArray(b.dimensions) ? (b.dimensions as string[]) : [];
  const now = nowIso();
  return {
    ok: true,
    record: {
      game_id: b.game_id as string,
      metric_name: b.metric_name as string,
      metric_codename: b.metric_codename as string,
      source: b.source as string,
      expression: b.expression as string,
      dimensions: dims,
      filter: typeof b.filter === 'string' ? b.filter : '',
      materialize: b.materialize === true,
      schedule: typeof b.schedule === 'string' ? b.schedule : '',
      created_at: now,
      updated_at: now,
    },
  };
}

export async function handlePost(req: IncomingMessage, res: ServerResponse, store: Store) {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    err(res, 400, 'INVALID_REQUEST', 'invalid JSON body');
    return;
  }
  const validated = validatePostBody(body);
  if (!validated.ok) {
    err(res, 400, 'INVALID_REQUEST', `missing or invalid field: ${validated.missing}`);
    return;
  }
  const k = keyOf(validated.record.game_id, validated.record.metric_name);
  if (store.has(k)) {
    err(res, 409, 'METRIC_EXISTED', `metric ${validated.record.metric_name} already exists`);
    return;
  }
  store.set(k, validated.record);
  ok(res, validated.record);
}

export function handleListByGame(
  res: ServerResponse,
  store: Store,
  gameId: string,
  searchParams: URLSearchParams,
) {
  if (!hasGame(store, gameId)) {
    err(res, 404, 'GAME_NOT_FOUND', `no metrics for game_id ${gameId}`);
    return;
  }
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.max(1, Number(searchParams.get('page_size')) || DEFAULT_PAGE_SIZE);
  const metricsParam = searchParams.get('metrics');
  const filter = metricsParam ? new Set(metricsParam.split(',').filter(Boolean)) : null;

  const all: MetricRecord[] = [];
  for (const [k, v] of store) {
    if (!k.startsWith(`${gameId}:`)) continue;
    if (filter && !filter.has(v.metric_name)) continue;
    all.push(v);
  }
  const start = (page - 1) * pageSize;
  const slice = all.slice(start, start + pageSize);
  ok(res, slice, { page, page_size: pageSize, total: all.length });
}

export function handleGetTotal(res: ServerResponse, store: Store, gameId: string) {
  if (!hasGame(store, gameId)) {
    err(res, 404, 'GAME_NOT_FOUND', `no metrics for game_id ${gameId}`);
    return;
  }
  let total = 0;
  for (const k of store.keys()) if (k.startsWith(`${gameId}:`)) total += 1;
  ok(res, { game_id: gameId, total_metrics: total });
}

export function handleGetOne(
  res: ServerResponse,
  store: Store,
  gameId: string,
  metricName: string,
) {
  if (!hasGame(store, gameId)) {
    err(res, 404, 'GAME_NOT_FOUND', `no metrics for game_id ${gameId}`);
    return;
  }
  const record = store.get(keyOf(gameId, metricName));
  if (!record) {
    err(res, 404, 'METRIC_NOT_FOUND', `metric ${metricName} not found`);
    return;
  }
  ok(res, record);
}

export function notFound(res: ServerResponse) {
  err(res, 404, 'NOT_FOUND', 'route not found');
}

export function internalError(res: ServerResponse, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  err(res, 500, 'INTERNAL_ERROR', message);
}
