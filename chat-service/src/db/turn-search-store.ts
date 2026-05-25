/**
 * Cross-turn full-text search over user_text, assistant_text, and tool args/results.
 * Uses LIKE with escape — sufficient for single-dev DB sizes (~5k turns).
 *
 * Cursor format: "${started_at}:${turn_id}" (deterministic, stable under new inserts).
 * Owner isolation enforced via JOIN on chat_sessions.owner_id.
 */

import type Database from 'better-sqlite3';

export interface SearchHit {
  turnId: string;
  sessionId: string;
  sessionTitle: string | null;
  role: string;
  snippet: string;
  matchSource: 'user_text' | 'assistant_text' | 'tool';
  createdAt: string; // ISO string
  starred: boolean;
  flag: string | null;
}

export interface SearchPage {
  results: SearchHit[];
  nextCursor: string | null;
}

export interface SearchParams {
  ownerId: string;
  q: string;
  gameId?: string;
  starredOnly?: boolean;
  cursor?: string; // "${started_at}:${turn_id}"
  limit?: number;
}

/**
 * Build a 256-char snippet centered around the first match of `query` in `text`.
 * Returns the full text when no match found (still useful context).
 */
export function buildSnippet(text: string, query: string, windowChars = 256): string {
  const lText = text.toLowerCase();
  const lQuery = query.toLowerCase();
  const idx = lText.indexOf(lQuery);
  if (idx === -1) return text.slice(0, windowChars);

  const half = Math.floor(windowChars / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, start + windowChars);
  const snippet = text.slice(start, end);

  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
}

/** Escape LIKE special chars so user input is treated literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Decode cursor string into parts; returns null on malformed input. */
function decodeCursor(cursor: string): { startedAt: number; turnId: string } | null {
  const colonIdx = cursor.indexOf(':');
  if (colonIdx === -1) return null;
  const startedAt = parseInt(cursor.slice(0, colonIdx), 10);
  const turnId = cursor.slice(colonIdx + 1);
  if (!Number.isFinite(startedAt) || !turnId) return null;
  return { startedAt, turnId };
}

/**
 * Search turns for an owner. Matches user_text, assistant_text, and any
 * tool_invocations.args_json or tool_invocations.result_summary for the turn.
 *
 * Returns at most `limit` results ordered by started_at DESC, turn_id DESC
 * (stable cursor pagination).
 */
export function searchTurns(db: Database.Database, params: SearchParams): SearchPage {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const pattern = `%${escapeLike(params.q)}%`;

  const bindings: unknown[] = [params.ownerId];
  const conditions: string[] = ['cs.owner_id = ?'];

  if (params.gameId) {
    conditions.push('cs.game_id = ?');
    bindings.push(params.gameId);
  }

  if (params.starredOnly) {
    conditions.push('ta.starred = 1');
  }

  // Cursor: fetch rows strictly before the cursor position
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      conditions.push('(ct.started_at < ? OR (ct.started_at = ? AND ct.id < ?))');
      bindings.push(decoded.startedAt, decoded.startedAt, decoded.turnId);
    }
  }

  // LIKE pattern bindings (x4: user_text, assistant_text, args_json, result_summary)
  bindings.push(pattern, pattern, pattern, pattern);
  bindings.push(limit + 1); // fetch one extra to detect hasMore

  const sql = `
    SELECT
      ct.id          AS turn_id,
      ct.session_id  AS session_id,
      cs.title       AS session_title,
      ct.role        AS role,
      ct.started_at  AS started_at,
      ct.user_text   AS user_text,
      ct.assistant_text AS assistant_text,
      COALESCE(ta.starred, 0) AS starred,
      ta.flag        AS flag
    FROM chat_turns ct
    JOIN chat_sessions cs ON cs.id = ct.session_id
    LEFT JOIN turn_annotations ta
      ON ta.turn_id = ct.id AND ta.owner_id = cs.owner_id
    WHERE ${conditions.join(' AND ')}
      AND (
        ct.user_text LIKE ? ESCAPE '\\'
        OR ct.assistant_text LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM tool_invocations ti
          WHERE ti.turn_id = ct.id
            AND (ti.args_json LIKE ? ESCAPE '\\' OR ti.result_summary LIKE ? ESCAPE '\\')
        )
      )
    ORDER BY ct.started_at DESC, ct.id DESC
    LIMIT ?
  `;

  type RawRow = {
    turn_id: string;
    session_id: string;
    session_title: string | null;
    role: string;
    started_at: number;
    user_text: string | null;
    assistant_text: string | null;
    starred: number;
    flag: string | null;
  };

  const rows = db.prepare(sql).all(...bindings) as RawRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const results: SearchHit[] = page.map((row) => {
    const lPattern = params.q.toLowerCase();
    let snippet = '';
    let matchSource: SearchHit['matchSource'] = 'user_text';

    if (row.user_text && row.user_text.toLowerCase().includes(lPattern)) {
      snippet = buildSnippet(row.user_text, params.q);
      matchSource = 'user_text';
    } else if (row.assistant_text && row.assistant_text.toLowerCase().includes(lPattern)) {
      snippet = buildSnippet(row.assistant_text, params.q);
      matchSource = 'assistant_text';
    } else {
      snippet = buildSnippet(row.user_text ?? row.assistant_text ?? '', params.q);
      matchSource = 'tool';
    }

    return {
      turnId: row.turn_id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      role: row.role,
      snippet,
      matchSource,
      createdAt: new Date(row.started_at).toISOString(),
      starred: row.starred === 1,
      flag: row.flag,
    };
  });

  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? `${last.started_at}:${last.turn_id}`
    : null;

  return { results, nextCursor };
}
