/**
 * Debug API routes — triage UI for per-turn LLM observability data.
 *
 * All routes enforce X-Owner-Id ownership. Designed for dev/internal use only.
 * Sessions include archived AND soft-deleted ones (unlike /sessions).
 *
 *   GET    /debug/sessions?game=&q=&limit=       — list all owner sessions (incl. archived + deleted)
 *   GET    /debug/sessions/:id                   — session detail + augmented turn list (incl. deleted)
 *   POST   /debug/sessions/:id/restore           — delegates to POST /sessions/:id/restore (KISS)
 *   DELETE /debug/sessions/:id                   — hard-purge a soft-deleted session (writes tombstone)
 *   GET    /debug/turns/:turnId                  — llm_calls + tool_invocations for a turn
 *   GET    /debug/turns/:turnId/raw?cursor=&limit= — paginated sdk_events
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import * as chatStore from '../db/chat-store.js';
import * as obsStore from '../db/observability-store.js';
import * as annotationsStore from '../db/annotations-store.js';
import {
  getCachedTurnDetail,
  putCachedTurnDetail,
} from '../cache/turn-detail-cache-adapter.js';
import type { ChatSessionRow, ChatTurnRow, QueryArtifact, ChartArtifact, PermissionDecisionRow } from '../types.js';
// Shared owner-guard helpers — imported and re-exported for sub-plugins.
import { extractOwnerId, getTurnOwnerId } from './debug-shared.js';
export { extractOwnerId, getTurnOwnerId } from './debug-shared.js';

// ---------------------------------------------------------------------------
// Debug session DTO — extends the raw row with camelCase deletedAt field
// so the FE can distinguish deleted sessions from live ones.
// ---------------------------------------------------------------------------

interface DebugSessionDto extends ChatSessionRow {
  deletedAt: number | null;
}

function toDebugSessionDto(row: ChatSessionRow): DebugSessionDto {
  return { ...row, deletedAt: row.deleted_at ?? null };
}

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
  /** Phase-02: turn-level stop_reason from SDK result message. */
  stopReason: string | null;
  /** Phase-03: Anthropic cache token breakdown. Null for legacy turns. */
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  /** Phase-06: true when this turn was served from the response cache. */
  cacheHit: boolean;
  /** Phase-06: original turn id that seeded the cache entry; null when not a cache hit. */
  originalTurnId: string | null;
  /** Phase-06: session id of the original cached turn (for cross-session navigation). */
  originalSessionId: string | null;
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function rowToDebugTurn(
  db: Database.Database,
  row: ChatTurnRow,
  llmCallCount: number,
  toolInvocationCount: number,
  sdkCount: number,
): DebugTurnDto {
  const text = row.role === 'user' ? row.user_text ?? '' : row.assistant_text ?? '';
  // Legacy only makes sense for assistant turns — user turns never produce LLM
  // calls, tool invocations, or SDK rows, so the zero-count condition would
  // tag every user turn as legacy.
  const legacy =
    row.role === 'assistant' && llmCallCount === 0 && toolInvocationCount === 0 && sdkCount === 0;
  const durationMs = row.ended_at != null && row.started_at != null ? row.ended_at - row.started_at : null;

  // Phase-06: resolve original session id for cache-hit turns.
  // Look up the original turn row to find its session_id.
  let originalSessionId: string | null = null;
  const isCacheHit = (row.cache_hit ?? 0) === 1;
  if (isCacheHit && row.original_turn_id) {
    const orig = chatStore.getTurnById(db, row.original_turn_id);
    originalSessionId = orig?.session_id ?? null;
  }

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
    // Phase-02: turn-level stop_reason (null/undefined for legacy turns).
    stopReason: row.stop_reason ?? null,
    // Phase-03: cache token breakdown (null for legacy turns pre-migration).
    cacheCreationTokens: row.cache_creation_tokens ?? null,
    cacheReadTokens: row.cache_read_tokens ?? null,
    // Phase-06: cache hit fields.
    cacheHit: isCacheHit,
    originalTurnId: row.original_turn_id ?? null,
    originalSessionId,
  };
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
  // Includes archived AND soft-deleted sessions (debug UI shows all).
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
      return reply.send(sessions.map(toDebugSessionDto));
    },
  );

  // GET /debug/sessions/:id
  // Includes soft-deleted sessions (no deleted_at filter) so the audit UI can inspect them.
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
        return rowToDebugTurn(db, row, counts.llm, counts.tool, counts.sdk);
      });

      return reply.send({ session: toDebugSessionDto(session), turns });
    },
  );

  // POST /debug/sessions/:id/restore — delegates to the core restore logic.
  // Owner-scoped: X-Owner-Id must match the session's owner.
  fastify.post<{ Params: { id: string } }>(
    '/debug/sessions/:id/restore',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const session = chatStore.getSession(db, req.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (session.owner_id !== ownerId) return reply.status(403).send({ error: 'Forbidden' });

      chatStore.restoreSession(db, req.params.id);
      const restored = chatStore.getSession(db, req.params.id);
      return reply.status(200).send(toDebugSessionDto(restored!));
    },
  );

  // DELETE /debug/sessions/:id — hard-purge a soft-deleted session.
  // Requires the session to already be soft-deleted (deleted_at != null) so the
  // audit UI cannot accidentally bypass the soft-delete step. Returns 409 if
  // the session is still live. Writes a tombstone so other dev machines drop
  // the row when they hydrate from snapshot.
  fastify.delete<{ Params: { id: string } }>(
    '/debug/sessions/:id',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const session = chatStore.getSession(db, req.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (session.owner_id !== ownerId) return reply.status(403).send({ error: 'Forbidden' });
      if (session.deleted_at == null) {
        return reply.status(409).send({ error: 'Session must be soft-deleted before purge' });
      }

      chatStore.deleteSession(db, req.params.id);
      return reply.status(204).send();
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

      // Cache fast-path: serve the immutable portion (llm_calls + tool_invocations
      // + permission_decisions) from kv_cache when available. Annotations stay
      // live since they're owner-keyed and mutable (star/flag/note).
      let llmCalls: unknown[];
      let toolInvocations: unknown[];
      let permissionDecisions: PermissionDecisionRow[];
      const cached = getCachedTurnDetail(db, req.params.turnId);
      if (cached) {
        llmCalls = cached.llmCalls;
        toolInvocations = cached.toolInvocations;
        permissionDecisions = cached.permissionDecisions as PermissionDecisionRow[];
      } else {
        llmCalls = obsStore.listLlmCallsByTurn(db, req.params.turnId);
        toolInvocations = obsStore.listToolInvocationsByTurn(db, req.params.turnId);
        permissionDecisions = obsStore.listPermissionDecisionsByTurn(db, req.params.turnId);

        // Only cache once the turn is finalised; otherwise we'd memoize a
        // partial in-flight payload that stays stale until eviction.
        const turn = chatStore.getTurnById(db, req.params.turnId);
        if (turn?.ended_at != null && turn.stop_reason != null) {
          putCachedTurnDetail(db, req.params.turnId, {
            llmCalls,
            toolInvocations,
            permissionDecisions,
          });
        }
      }

      const annotationRow = annotationsStore.getAnnotation(db, req.params.turnId, ownerId);
      const annotation = annotationRow ? {
        turnId: annotationRow.turn_id,
        starred: annotationRow.starred === 1,
        flag: annotationRow.flag,
        note: annotationRow.note,
        updatedAt: annotationRow.updated_at,
      } : null;
      return reply.send({ llmCalls, toolInvocations, permissionDecisions, annotation });
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
