/**
 * Debug API routes — triage UI for per-turn LLM observability data.
 *
 * All routes enforce X-Owner-Id ownership. Designed for dev/internal use only.
 * Sessions include archived ones (unlike /sessions which hides them).
 *
 *   GET /debug/sessions?game=&q=&limit=      — list all owner sessions (incl. archived)
 *   GET /debug/sessions/:id                  — session detail + augmented turn list
 *   GET /debug/turns/:turnId                 — llm_calls + tool_invocations for a turn
 *   GET /debug/turns/:turnId/raw?cursor=&limit= — paginated sdk_events
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import * as chatStore from '../db/chat-store.js';
import * as obsStore from '../db/observability-store.js';
import type { ChatTurnRow, QueryArtifact, ChartArtifact } from '../types.js';

// ---------------------------------------------------------------------------
// Turn row → DTO (duplicated from sessions.ts to keep file ownership clean)
// ---------------------------------------------------------------------------

interface DebugTurnDto {
  id: string;
  role: 'user' | 'assistant' | 'system_preamble';
  text: string;
  createdAt: string;
  toolCalls: Array<{ id: string; name: string; ok: boolean; ms: number; summary: string }>;
  artifacts: QueryArtifact[];
  charts: ChartArtifact[];
  /** True when no observability rows exist for this turn (pre-feature session). */
  legacy: boolean;
  llmCallCount: number;
  toolInvocationCount: number;
  /** Aggregate from chat_turns — set on the assistant row after the SDK result message. */
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  model: string | null;
  skill: string | null;
  durationMs: number | null;
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function rowToDebugTurn(row: ChatTurnRow, llmCallCount: number, toolInvocationCount: number, sdkCount: number): DebugTurnDto {
  const text = row.role === 'user' ? row.user_text ?? '' : row.assistant_text ?? '';
  const legacy = llmCallCount === 0 && toolInvocationCount === 0 && sdkCount === 0;
  const durationMs = row.ended_at != null && row.started_at != null ? row.ended_at - row.started_at : null;
  return {
    id: row.id,
    role: row.role,
    text,
    createdAt: new Date(row.started_at).toISOString(),
    toolCalls: safeParseJson(row.tool_calls_json, []),
    artifacts: safeParseJson(row.artifacts_json, []),
    charts: safeParseJson(row.charts_json, []),
    legacy,
    llmCallCount,
    toolInvocationCount,
    // Aggregate usage from chat_turns. Per-call usage is 0 (SDK limit) but the
    // result-message totals land here, so we expose them at the turn level.
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    model: row.model,
    skill: row.skill,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Owner guard helpers
// ---------------------------------------------------------------------------

/** Extracts and validates X-Owner-Id header; returns null if missing/invalid. */
function extractOwnerId(headers: Record<string, string | string[] | undefined>): string | null {
  const h = headers['x-owner-id'];
  return typeof h === 'string' && h.trim() ? h.trim() : null;
}

/**
 * Resolves the owner_id of a turn's owning session via a JOIN.
 * Returns null when the turn doesn't exist.
 */
function getTurnOwnerId(db: Database.Database, turnId: string): string | null {
  const row = db
    .prepare(
      `SELECT cs.owner_id FROM chat_sessions cs
       JOIN chat_turns ct ON ct.session_id = cs.id
       WHERE ct.id = ?`,
    )
    .get(turnId) as { owner_id: string } | undefined;
  return row?.owner_id ?? null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

interface DebugRouteOptions {
  db: Database.Database;
}

const debugRoutes: FastifyPluginAsync<DebugRouteOptions> = async (fastify, opts) => {
  const { db } = opts;

  // GET /debug/sessions?game=<id>&q=<title-substring>&limit=<n>
  fastify.get<{ Querystring: { game?: string; q?: string; limit?: string } }>(
    '/debug/sessions',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
      const sessions = obsStore.listSessionsForDebug(db, {
        ownerId,
        gameId: req.query.game,
        q: req.query.q,
        limit,
      });
      return reply.send(sessions);
    },
  );

  // GET /debug/sessions/:id
  fastify.get<{ Params: { id: string } }>(
    '/debug/sessions/:id',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const session = chatStore.getSession(db, req.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (session.owner_id !== ownerId) return reply.status(403).send({ error: 'Forbidden' });

      // Augment each turn with observability counts + legacy flag
      const rawTurns = chatStore.listTurns(db, session.id);
      const turns: DebugTurnDto[] = rawTurns.map((row) => {
        const counts = obsStore.countObservabilityRowsByTurn(db, row.id);
        return rowToDebugTurn(row, counts.llm, counts.tool, counts.sdk);
      });

      return reply.send({ session, turns });
    },
  );

  // GET /debug/turns/:turnId
  fastify.get<{ Params: { turnId: string } }>(
    '/debug/turns/:turnId',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const turnOwner = getTurnOwnerId(db, req.params.turnId);
      if (turnOwner === null) return reply.status(404).send({ error: 'Turn not found' });
      if (turnOwner !== ownerId) return reply.status(403).send({ error: 'Forbidden' });

      const llmCalls = obsStore.listLlmCallsByTurn(db, req.params.turnId);
      const toolInvocations = obsStore.listToolInvocationsByTurn(db, req.params.turnId);
      return reply.send({ llmCalls, toolInvocations });
    },
  );

  // GET /debug/turns/:turnId/raw?cursor=<seq>&limit=<n>
  fastify.get<{ Params: { turnId: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/debug/turns/:turnId/raw',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const turnOwner = getTurnOwnerId(db, req.params.turnId);
      if (turnOwner === null) return reply.status(404).send({ error: 'Turn not found' });
      if (turnOwner !== ownerId) return reply.status(403).send({ error: 'Forbidden' });

      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '200', 10) || 200, 1), 1000);
      const cursor = parseInt(req.query.cursor ?? '0', 10) || 0;

      const { rows: events, nextCursor } = obsStore.listSdkEventsByTurn(db, req.params.turnId, { cursor, limit });
      return reply.send({ events, nextCursor });
    },
  );
};

export default debugRoutes;
