/**
 * Minimal Trino client over Trino's HTTP statement protocol.
 *
 * Deliberately implemented with `fetch` rather than adding a `trino-client`
 * npm dependency: it keeps the build dependency-free, matches the codebase's
 * thin-fetch style (`cube-client.ts`), and the security surface is identical —
 * the host is always server-owned (from a `Connector`), never client-supplied.
 *
 * The transport is statement-agnostic: it issues whatever SQL a caller hands
 * it (SELECT for the profiler; DDL/DML for the lakehouse snapshot writer). The
 * security surface is unchanged either way — the host is always server-owned
 * (from a `Connector`), never client-supplied.
 *
 * Protocol:
 *   POST {scheme}://{host}:{port}/v1/statement  body = SQL text
 *   → { id, nextUri?, columns?, data?, stats, error? }
 *   GET nextUri repeatedly until no nextUri; accumulate `data`.
 *   On timeout/abort: DELETE the last nextUri to cancel server-side.
 *
 * Credentials are redacted from every thrown error.
 */

import type { Connector } from './trino-profiler-config.js';
import { PROFILER_CAPS } from './trino-profiler-config.js';

interface TrinoColumn {
  name: string;
  type: string;
}

interface TrinoStatementResponse {
  id: string;
  nextUri?: string;
  columns?: TrinoColumn[];
  data?: unknown[][];
  error?: { message?: string; errorName?: string };
}

export interface TrinoResult {
  columns: TrinoColumn[];
  /** Row-major data; cell types are whatever Trino emits (string|number|null…). */
  rows: unknown[][];
}

function baseUrl(c: Connector): string {
  const scheme = c.ssl ? 'https' : 'http';
  return `${scheme}://${c.host}:${c.port}`;
}

function authHeader(c: Connector): Record<string, string> {
  if (!c.password) return {};
  const token = Buffer.from(`${c.user}:${c.password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/** Strip anything that looks like a credential from an error string. */
function redact(msg: string, c: Connector): string {
  let out = msg;
  if (c.password) out = out.split(c.password).join('***');
  // Only redact the user if it's distinctive enough to be a real identifier —
  // a short common substring (e.g. "a") would over-redact unrelated error text.
  if (c.user && c.user.length >= 4) out = out.split(c.user).join('***');
  return out;
}

async function trinoFetch(
  url: string,
  init: RequestInit,
  c: Connector,
  schema: string,
  signal: AbortSignal,
): Promise<TrinoStatementResponse> {
  const res = await fetch(url, {
    ...init,
    signal,
    headers: {
      'X-Trino-User': c.user,
      'X-Trino-Catalog': c.catalog,
      'X-Trino-Schema': schema,
      Accept: 'application/json',
      ...authHeader(c),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(redact(`Trino ${res.status}: ${text}`, c));
  }
  return (await res.json()) as TrinoStatementResponse;
}

/**
 * Execute one SQL statement and return all rows (empty for DDL/DML). The
 * connector's session is `c.catalog` + `schema`; fully-qualified table names in
 * the SQL override it. Bounded by `timeoutMs` — defaults to the profiler cap,
 * but write callers (cross-catalog INSERT over a full cohort) pass a larger
 * bound since those scans run well past 20s.
 */
export async function runQuery(
  c: Connector,
  schema: string,
  sql: string,
  timeoutMs: number = PROFILER_CAPS.statementTimeoutMs,
): Promise<TrinoResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let columns: TrinoColumn[] = [];
  const rows: unknown[][] = [];
  let lastNextUri: string | null = null;

  try {
    let resp = await trinoFetch(
      `${baseUrl(c)}/v1/statement`,
      { method: 'POST', body: sql, headers: { 'Content-Type': 'text/plain' } },
      c,
      schema,
      ctl.signal,
    );

    for (;;) {
      if (resp.error) {
        throw new Error(redact(`Trino query error: ${resp.error.message ?? resp.error.errorName ?? 'unknown'}`, c));
      }
      if (resp.columns && columns.length === 0) columns = resp.columns;
      if (resp.data) for (const r of resp.data) rows.push(r);
      lastNextUri = resp.nextUri ?? null;
      if (!resp.nextUri) break;
      resp = await trinoFetch(resp.nextUri, { method: 'GET' }, c, schema, ctl.signal);
    }
    return { columns, rows };
  } catch (err) {
    // Best-effort cancel of an in-flight query on the Trino side.
    if (lastNextUri) {
      void fetch(lastNextUri, { method: 'DELETE', headers: authHeader(c) }).catch(() => undefined);
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Trino statement timed out after ${timeoutMs / 1000}s`);
    }
    throw err instanceof Error ? new Error(redact(err.message, c)) : err;
  } finally {
    clearTimeout(timer);
  }
}
