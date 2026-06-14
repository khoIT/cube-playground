/**
 * Durable read/write API over the advisor agent run-audit tables (migration
 * 055). The runtime flushes one turn's worth of rows atomically here; the admin
 * audit routes read them back to debug and optimize the agent.
 *
 * Lives in the agent dir, so it is scanned by the no-PII surface guard: no
 * member contact column tokens appear here. Only the aggregate + actor-identity
 * allowlist is persisted; tool outputs arrive already redacted by the tool layer.
 */

import { getDb } from '../../db/sqlite.js';

// ─── Write-side shapes ──────────────────────────────────────────────────────

export interface RunRow {
  sessionId: string;
  gameId: string;
  segmentId?: string;
  scopeKind: string;
  goal: string;
  mode: string;
  owner?: string;
  model?: string;
  turnCount: number;
  totalCostUsd: number;
  finalStopReason: string;
  hadError: boolean;
  createdAt: number;
  lastActiveAt: number;
  /** Credential lane the agent ran on + the env var that carried the token. */
  authLane?: string;
  authSource?: string;
  /** Cumulative token usage across all turns of the run. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface TurnRow {
  sessionId: string;
  turnIndex: number;
  mode: string;
  message?: string;
  narration?: string;
  toolCallCount: number;
  stopReason: string;
  abortCause?: string;
  costUsd: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Per-turn token usage from the SDK result. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface ToolCallInput {
  callId?: string;
  tool: string;
  seq: number;
  inputJson?: string;
  outputDigest?: string;
  state: 'ok' | 'failed' | 'denied';
  errorMessage?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  /** A failure embedded in an otherwise-ok output (e.g. a Cube 400 in a lens). */
  embeddedError?: boolean;
  embeddedErrorMessage?: string;
}

export interface EventInput {
  turnIndex: number;
  eventIndex: number;
  eventType: string;
  eventJson: string;
  ts: number;
}

/** One turn's complete audit payload, persisted in a single transaction. */
export interface TurnFlush {
  run: RunRow;
  turn: TurnRow;
  toolCalls: ToolCallInput[];
  events: EventInput[];
}

// ─── Read-side shapes ───────────────────────────────────────────────────────

export interface RunSummary {
  sessionId: string;
  gameId: string;
  segmentId: string | null;
  scopeKind: string;
  goal: string;
  mode: string;
  owner: string | null;
  model: string | null;
  turnCount: number;
  totalCostUsd: number;
  finalStopReason: string | null;
  hadError: boolean;
  createdAt: number;
  lastActiveAt: number;
  authLane: string | null;
  authSource: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

export interface ToolCallRecord {
  id: number;
  callId: string | null;
  tool: string;
  seq: number;
  inputJson: string | null;
  outputDigest: string | null;
  state: string;
  errorMessage: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  embeddedError: boolean;
  embeddedErrorMessage: string | null;
}

export interface TurnWithToolCalls {
  id: number;
  turnIndex: number;
  mode: string;
  message: string | null;
  narration: string | null;
  toolCallCount: number;
  stopReason: string;
  abortCause: string | null;
  costUsd: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  toolCalls: ToolCallRecord[];
}

export interface RunDetail {
  run: RunSummary;
  turns: TurnWithToolCalls[];
}

export interface EventRecord {
  id: number;
  turnIndex: number;
  eventIndex: number;
  eventType: string;
  eventJson: string;
  ts: number;
}

export interface RunFilter {
  game?: string;
  goal?: string;
  owner?: string;
  stopReason?: string;
  q?: string;
  limit?: number;
}

// ─── DB row mappers ─────────────────────────────────────────────────────────

interface RunDbRow {
  session_id: string;
  game_id: string;
  segment_id: string | null;
  scope_kind: string;
  goal: string;
  mode: string;
  owner: string | null;
  model: string | null;
  turn_count: number;
  total_cost_usd: number;
  final_stop_reason: string | null;
  had_error: number;
  created_at: number;
  last_active_at: number;
  auth_lane: string | null;
  auth_source: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
}

function toRunSummary(r: RunDbRow): RunSummary {
  return {
    sessionId: r.session_id,
    gameId: r.game_id,
    segmentId: r.segment_id,
    scopeKind: r.scope_kind,
    goal: r.goal,
    mode: r.mode,
    owner: r.owner,
    model: r.model,
    turnCount: r.turn_count,
    totalCostUsd: r.total_cost_usd,
    finalStopReason: r.final_stop_reason,
    hadError: r.had_error === 1,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
    authLane: r.auth_lane,
    authSource: r.auth_source,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
  };
}

// ─── Write path ─────────────────────────────────────────────────────────────

/**
 * Persist one turn (run upsert + turn + its tool calls + its events) in a single
 * transaction. The run row is created on the first turn and bumped on each
 * subsequent turn; created_at is preserved across upserts.
 */
export function persistTurn(flush: TurnFlush): void {
  const db = getDb();
  const tx = db.transaction((f: TurnFlush) => {
    db.prepare(
      `INSERT INTO advisor_agent_run
         (session_id, game_id, segment_id, scope_kind, goal, mode, owner, model,
          turn_count, total_cost_usd, final_stop_reason, had_error, created_at, last_active_at,
          auth_lane, auth_source, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
       VALUES (@sessionId, @gameId, @segmentId, @scopeKind, @goal, @mode, @owner, @model,
          @turnCount, @totalCostUsd, @finalStopReason, @hadError, @createdAt, @lastActiveAt,
          @authLane, @authSource, @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreationTokens)
       ON CONFLICT(session_id) DO UPDATE SET
         turn_count            = excluded.turn_count,
         total_cost_usd        = excluded.total_cost_usd,
         final_stop_reason     = excluded.final_stop_reason,
         had_error             = excluded.had_error,
         last_active_at        = excluded.last_active_at,
         model                 = COALESCE(excluded.model, advisor_agent_run.model),
         input_tokens          = excluded.input_tokens,
         output_tokens         = excluded.output_tokens,
         cache_read_tokens     = excluded.cache_read_tokens,
         cache_creation_tokens = excluded.cache_creation_tokens`,
    ).run({
      sessionId: f.run.sessionId,
      gameId: f.run.gameId,
      segmentId: f.run.segmentId ?? null,
      scopeKind: f.run.scopeKind,
      goal: f.run.goal,
      mode: f.run.mode,
      owner: f.run.owner ?? null,
      model: f.run.model ?? null,
      turnCount: f.run.turnCount,
      totalCostUsd: f.run.totalCostUsd,
      finalStopReason: f.run.finalStopReason,
      hadError: f.run.hadError ? 1 : 0,
      createdAt: f.run.createdAt,
      lastActiveAt: f.run.lastActiveAt,
      authLane: f.run.authLane ?? null,
      authSource: f.run.authSource ?? null,
      inputTokens: f.run.inputTokens ?? null,
      outputTokens: f.run.outputTokens ?? null,
      cacheReadTokens: f.run.cacheReadTokens ?? null,
      cacheCreationTokens: f.run.cacheCreationTokens ?? null,
    });

    const turnInfo = db
      .prepare(
        `INSERT INTO advisor_agent_turn
           (session_id, turn_index, mode, message, narration, tool_call_count,
            stop_reason, abort_cause, cost_usd, started_at, ended_at, duration_ms,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
         VALUES (@sessionId, @turnIndex, @mode, @message, @narration, @toolCallCount,
            @stopReason, @abortCause, @costUsd, @startedAt, @endedAt, @durationMs,
            @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreationTokens)`,
      )
      .run({
        sessionId: f.turn.sessionId,
        turnIndex: f.turn.turnIndex,
        mode: f.turn.mode,
        message: f.turn.message ?? null,
        narration: f.turn.narration ?? null,
        toolCallCount: f.turn.toolCallCount,
        stopReason: f.turn.stopReason,
        abortCause: f.turn.abortCause ?? null,
        costUsd: f.turn.costUsd,
        startedAt: f.turn.startedAt,
        endedAt: f.turn.endedAt,
        durationMs: f.turn.durationMs,
        inputTokens: f.turn.inputTokens ?? null,
        outputTokens: f.turn.outputTokens ?? null,
        cacheReadTokens: f.turn.cacheReadTokens ?? null,
        cacheCreationTokens: f.turn.cacheCreationTokens ?? null,
      });
    const turnId = Number(turnInfo.lastInsertRowid);

    const insTool = db.prepare(
      `INSERT INTO advisor_tool_call
         (session_id, turn_id, call_id, tool, seq, input_json, output_digest,
          state, error_message, started_at, ended_at, duration_ms,
          embedded_error, embedded_error_message)
       VALUES (@sessionId, @turnId, @callId, @tool, @seq, @inputJson, @outputDigest,
          @state, @errorMessage, @startedAt, @endedAt, @durationMs,
          @embeddedError, @embeddedErrorMessage)`,
    );
    for (const c of f.toolCalls) {
      insTool.run({
        sessionId: f.turn.sessionId,
        turnId,
        callId: c.callId ?? null,
        tool: c.tool,
        seq: c.seq,
        inputJson: c.inputJson ?? null,
        outputDigest: c.outputDigest ?? null,
        state: c.state,
        errorMessage: c.errorMessage ?? null,
        startedAt: c.startedAt ?? null,
        endedAt: c.endedAt ?? null,
        durationMs: c.durationMs ?? null,
        embeddedError: c.embeddedError ? 1 : 0,
        embeddedErrorMessage: c.embeddedErrorMessage ?? null,
      });
    }

    const insEvent = db.prepare(
      `INSERT INTO advisor_event_log
         (session_id, turn_index, event_index, event_type, event_json, ts)
       VALUES (@sessionId, @turnIndex, @eventIndex, @eventType, @eventJson, @ts)`,
    );
    for (const e of f.events) {
      insEvent.run({
        sessionId: f.turn.sessionId,
        turnIndex: e.turnIndex,
        eventIndex: e.eventIndex,
        eventType: e.eventType,
        eventJson: e.eventJson,
        ts: e.ts,
      });
    }
  });
  tx(flush);
}

// ─── Read path ──────────────────────────────────────────────────────────────

const MAX_LIMIT = 500;

export function listRuns(filter: RunFilter = {}): RunSummary[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.game) {
    where.push('game_id = @game');
    params.game = filter.game;
  }
  if (filter.goal) {
    where.push('goal = @goal');
    params.goal = filter.goal;
  }
  if (filter.owner) {
    where.push('owner = @owner');
    params.owner = filter.owner;
  }
  if (filter.stopReason && filter.stopReason !== 'all') {
    where.push('final_stop_reason = @stopReason');
    params.stopReason = filter.stopReason;
  }
  if (filter.q && filter.q.trim()) {
    where.push('(goal LIKE @q OR game_id LIKE @q OR segment_id LIKE @q OR session_id LIKE @q)');
    params.q = `%${filter.q.trim()}%`;
  }
  const limit = Math.min(Math.max(1, filter.limit ?? MAX_LIMIT), MAX_LIMIT);
  const sql =
    `SELECT * FROM advisor_agent_run` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY created_at DESC LIMIT ${limit}`;
  const rows = db.prepare(sql).all(params) as RunDbRow[];
  return rows.map(toRunSummary);
}

export function getRunDetail(sessionId: string): RunDetail | null {
  const db = getDb();
  const runRow = db
    .prepare('SELECT * FROM advisor_agent_run WHERE session_id = ?')
    .get(sessionId) as RunDbRow | undefined;
  if (!runRow) return null;

  const turnRows = db
    .prepare('SELECT * FROM advisor_agent_turn WHERE session_id = ? ORDER BY turn_index ASC')
    .all(sessionId) as Array<{
    id: number;
    turn_index: number;
    mode: string;
    message: string | null;
    narration: string | null;
    tool_call_count: number;
    stop_reason: string;
    abort_cause: string | null;
    cost_usd: number;
    started_at: number;
    ended_at: number;
    duration_ms: number;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
  }>;

  const toolStmt = db.prepare(
    'SELECT * FROM advisor_tool_call WHERE turn_id = ? ORDER BY seq ASC, id ASC',
  );

  const turns: TurnWithToolCalls[] = turnRows.map((t) => {
    const calls = toolStmt.all(t.id) as Array<{
      id: number;
      call_id: string | null;
      tool: string;
      seq: number;
      input_json: string | null;
      output_digest: string | null;
      state: string;
      error_message: string | null;
      started_at: number | null;
      ended_at: number | null;
      duration_ms: number | null;
      embedded_error: number | null;
      embedded_error_message: string | null;
    }>;
    return {
      id: t.id,
      turnIndex: t.turn_index,
      mode: t.mode,
      message: t.message,
      narration: t.narration,
      toolCallCount: t.tool_call_count,
      stopReason: t.stop_reason,
      abortCause: t.abort_cause,
      costUsd: t.cost_usd,
      startedAt: t.started_at,
      endedAt: t.ended_at,
      durationMs: t.duration_ms,
      inputTokens: t.input_tokens,
      outputTokens: t.output_tokens,
      cacheReadTokens: t.cache_read_tokens,
      cacheCreationTokens: t.cache_creation_tokens,
      toolCalls: calls.map((c) => ({
        id: c.id,
        callId: c.call_id,
        tool: c.tool,
        seq: c.seq,
        inputJson: c.input_json,
        outputDigest: c.output_digest,
        state: c.state,
        errorMessage: c.error_message,
        startedAt: c.started_at,
        endedAt: c.ended_at,
        durationMs: c.duration_ms,
        embeddedError: c.embedded_error === 1,
        embeddedErrorMessage: c.embedded_error_message,
      })),
    };
  });

  return { run: toRunSummary(runRow), turns };
}

export function listEvents(
  sessionId: string,
  opts: { turnIndex?: number; cursor?: number; limit?: number } = {},
): { events: EventRecord[]; nextCursor: number | null } {
  const db = getDb();
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1000);
  const where: string[] = ['session_id = @sessionId'];
  const params: Record<string, unknown> = { sessionId };
  if (typeof opts.turnIndex === 'number') {
    where.push('turn_index = @turnIndex');
    params.turnIndex = opts.turnIndex;
  }
  if (typeof opts.cursor === 'number') {
    where.push('id > @cursor');
    params.cursor = opts.cursor;
  }
  const rows = db
    .prepare(
      `SELECT * FROM advisor_event_log WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ${limit + 1}`,
    )
    .all(params) as Array<{
    id: number;
    turn_index: number;
    event_index: number;
    event_type: string;
    event_json: string;
    ts: number;
  }>;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    events: page.map((e) => ({
      id: e.id,
      turnIndex: e.turn_index,
      eventIndex: e.event_index,
      eventType: e.event_type,
      eventJson: e.event_json,
      ts: e.ts,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export function listOwners(): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT owner FROM advisor_agent_run WHERE owner IS NOT NULL AND owner <> '' ORDER BY owner ASC`,
    )
    .all() as Array<{ owner: string }>;
  return rows.map((r) => r.owner);
}

/**
 * Delete runs (and all child rows) created strictly before cutoffMs. Children
 * are deleted explicitly so retention works even where the foreign_keys pragma
 * is off. Returns the number of runs removed.
 */
export function pruneOlderThan(cutoffMs: number): number {
  const db = getDb();
  const tx = db.transaction((cutoff: number) => {
    const stale = db
      .prepare('SELECT session_id FROM advisor_agent_run WHERE created_at < ?')
      .all(cutoff) as Array<{ session_id: string }>;
    if (stale.length === 0) return 0;
    const delEvents = db.prepare('DELETE FROM advisor_event_log WHERE session_id = ?');
    const delTools = db.prepare('DELETE FROM advisor_tool_call WHERE session_id = ?');
    const delTurns = db.prepare('DELETE FROM advisor_agent_turn WHERE session_id = ?');
    const delRun = db.prepare('DELETE FROM advisor_agent_run WHERE session_id = ?');
    for (const { session_id } of stale) {
      delEvents.run(session_id);
      delTools.run(session_id);
      delTurns.run(session_id);
      delRun.run(session_id);
    }
    return stale.length;
  });
  return tx(cutoffMs);
}
