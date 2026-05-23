/**
 * chat-sse-client — thin SSE client for POST /api/chat/sessions/:id/turn.
 *
 * Returns { stream: AsyncIterable<SseEvent>, cancel: () => void }.
 * Parses text/event-stream line-by-line (double-newline delimited blocks).
 * Handles backpressure via AbortController.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SseEventBase {
  type: string;
}

export interface SseSessionCreated extends SseEventBase {
  type: 'session_created';
  data: { id: string };
}
export interface SseLoading extends SseEventBase {
  type: 'loading';
  data: Record<string, never>;
}
export interface SseThinking extends SseEventBase {
  type: 'thinking';
  data: { delta: string };
}
export interface SseToolCall extends SseEventBase {
  type: 'tool_call';
  data: { id: string; name: string; args: unknown };
}
export interface SseToolResult extends SseEventBase {
  type: 'tool_result';
  data: { id: string; ok: boolean; ms: number; summary: string };
}
export interface SseToken extends SseEventBase {
  type: 'token';
  data: { delta: string };
}

/** QueryArtifact shape — mirrors chat-service/src/types.ts */
export interface QueryArtifact {
  id: string;
  title: string;
  summary: string;
  query: unknown;
  source: 'business-metric' | 'segment' | 'raw';
  sourceRef?: { id: string; name?: string };
  deeplinkUrl: string;
  deeplinkVia: 'inline' | 'session-storage';
  payload: unknown;
}

export interface SseQueryArtifact extends SseEventBase {
  type: 'query_artifact';
  data: QueryArtifact;
}
export interface SseResult extends SseEventBase {
  type: 'result';
  data: {
    text: string;
    cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}
export interface SseError extends SseEventBase {
  type: 'error';
  data: { code: string; message: string };
}
export interface SseDone extends SseEventBase {
  type: 'done';
  data: Record<string, never>;
}

export type SseEvent =
  | SseSessionCreated
  | SseLoading
  | SseThinking
  | SseToolCall
  | SseToolResult
  | SseToken
  | SseQueryArtifact
  | SseResult
  | SseError
  | SseDone;

// ---------------------------------------------------------------------------
// Owner ID helper — read from localStorage (dev convention)
// ---------------------------------------------------------------------------

function getOwnerId(): string {
  try {
    return window.localStorage.getItem('gds-cube:owner') ?? 'dev';
  } catch {
    return 'dev';
  }
}

// ---------------------------------------------------------------------------
// SSE parser — splits raw text into (type, data) pairs
// ---------------------------------------------------------------------------

interface RawSseBlock {
  event: string;
  data: string;
}

/**
 * Parse accumulated SSE buffer into blocks on each `\n\n` boundary.
 * Returns { blocks, remainder } where remainder is the partial block
 * not yet terminated.
 */
function parseSseBuffer(
  buffer: string,
): { blocks: RawSseBlock[]; remainder: string } {
  const parts = buffer.split('\n\n');
  const remainder = parts.pop() ?? '';
  const blocks: RawSseBlock[] = [];

  for (const part of parts) {
    const lines = part.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice('data:'.length).trim();
      }
    }
    if (event && data !== '') {
      blocks.push({ event, data });
    }
  }
  return { blocks, remainder };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OpenChatTurnOptions {
  sessionId: string | null;
  message: string;
  game: string;
  context?: unknown;
}

export interface ChatTurnHandle {
  stream: AsyncIterable<SseEvent>;
  cancel: () => void;
}

/**
 * Open a streaming chat turn against the server proxy.
 *
 * - sessionId: null or 'new' → server creates a new session.
 * - The returned AsyncIterable yields parsed SseEvent objects.
 * - call cancel() to abort in-flight.
 */
export function openChatTurn(options: OpenChatTurnOptions): ChatTurnHandle {
  const { sessionId, message, game, context } = options;
  const controller = new AbortController();

  const pathId = sessionId && sessionId !== 'new' ? sessionId : 'new';
  const url = `/api/chat/sessions/${pathId}/turn`;

  async function* generateEvents(): AsyncIterable<SseEvent> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owner-Id': getOwnerId(),
        },
        body: JSON.stringify({ message, game, context }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      // Abort is expected on cancel() — don't re-throw as an error event.
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || controller.signal.aborted)
      ) {
        return;
      }
      throw err;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let errData: { code: string; message: string };
      try {
        errData = JSON.parse(body);
      } catch {
        errData = { code: `http_${response.status}`, message: body || response.statusText };
      }
      yield { type: 'error', data: errData } as SseError;
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', data: { code: 'no_body', message: 'Response has no body' } } as SseError;
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        const { blocks, remainder } = parseSseBuffer(buffer);
        buffer = remainder;

        for (const block of blocks) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(block.data);
          } catch {
            // Skip malformed JSON data fields.
            continue;
          }
          yield { type: block.event, data: parsed } as SseEvent;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  return {
    stream: generateEvents(),
    cancel: () => controller.abort(),
  };
}
