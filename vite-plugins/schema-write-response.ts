/**
 * schema-write-response.ts
 * Shared HTTP response helpers for the schema-write middleware.
 */

import type { ServerResponse } from 'node:http';

export function jsonError(res: ServerResponse, status: number, reason: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, reason }));
}

export function jsonOk(res: ServerResponse, payload: Record<string, unknown>): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ...payload }));
}
