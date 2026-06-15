/**
 * User-facing advisor run history — lets a signed-in user revisit their OWN past
 * Drive investigations. The admin audit console (/admin/dev/advisor-audit) shows
 * everyone's runs with full internals; this surface is owner-scoped and carries
 * only the investigation narrative (goal · scope · outcome · narration · which
 * tools ran), never another user's runs and never raw tool I/O.
 *
 *   GET /api/advisor/runs            → my recent runs (lean summary list)
 *   GET /api/advisor/runs/:sessionId → one of MY runs, as a read-only transcript
 *
 * Owner parity: a live run is tagged `owner = req.user.username ?? req.user.email`
 * at record time (see advisor.ts). We resolve the caller with the SAME expression
 * so the recorded form (e.g. the username 'khoitn') matches — principal.email
 * ('khoitn@…') would not. A request with no resolvable owner sees an empty list.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireFeature } from '../middleware/require-feature.js';
import { listRuns, getRunDetail, type RunSummary } from '../advisor/agent/advisor-run-store.js';

/** Max runs returned in the history list (newest first). */
const HISTORY_LIMIT = 50;

/** Lean, non-sensitive run header shown in the history list + replay header. */
interface RunListItem {
  sessionId: string;
  gameId: string;
  segmentId: string | null;
  scopeKind: string;
  goal: string;
  mode: string;
  finalStopReason: string | null;
  turnCount: number;
  totalCostUsd: number;
  createdAt: number;
  lastActiveAt: number;
}

interface ReplayToolCall {
  tool: string;
  state: string;
  /** ok and no hidden upstream error — the number/result is safe to trust. */
  validated: boolean;
}

interface ReplayTurn {
  turnIndex: number;
  mode: string;
  message: string | null;
  narration: string | null;
  stopReason: string;
  toolCalls: ReplayToolCall[];
}

interface RunReplay {
  run: RunListItem;
  turns: ReplayTurn[];
}

/** Same expression used at record time so the recorded owner form matches. */
function resolveRunOwner(req: FastifyRequest): string | null {
  return req.user?.username ?? req.user?.email ?? null;
}

function toListItem(r: RunSummary): RunListItem {
  return {
    sessionId: r.sessionId,
    gameId: r.gameId,
    segmentId: r.segmentId,
    scopeKind: r.scopeKind,
    goal: r.goal,
    mode: r.mode,
    finalStopReason: r.finalStopReason,
    turnCount: r.turnCount,
    totalCostUsd: r.totalCostUsd,
    createdAt: r.createdAt,
    lastActiveAt: r.lastActiveAt,
  };
}

export default async function advisorRunHistoryRoutes(app: FastifyInstance): Promise<void> {
  // Same restricted-surface gate as the main advisor routes.
  app.addHook('preHandler', requireFeature('advisor'));

  // --- GET /api/advisor/runs — the caller's own recent runs ---
  app.get('/api/advisor/runs', async (req: FastifyRequest) => {
    const owner = resolveRunOwner(req);
    if (!owner) return { runs: [] };
    const runs = listRuns({ owner, limit: HISTORY_LIMIT }).map(toListItem);
    return { runs };
  });

  // --- GET /api/advisor/runs/:sessionId — one of the caller's runs, read-only ---
  app.get<{ Params: { sessionId: string } }>(
    '/api/advisor/runs/:sessionId',
    async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const owner = resolveRunOwner(req);
      const { sessionId } = req.params;
      const detail = getRunDetail(sessionId);
      // 404 (not 403) when missing OR not the caller's — never leak the
      // existence of another user's run.
      if (!detail || !owner || detail.run.owner !== owner) {
        return reply.status(404).send({ error: 'run not found' });
      }
      const replay: RunReplay = {
        run: toListItem(detail.run),
        turns: detail.turns.map((t) => ({
          turnIndex: t.turnIndex,
          mode: t.mode,
          message: t.message,
          narration: t.narration,
          stopReason: t.stopReason,
          toolCalls: t.toolCalls.map((c) => ({
            tool: c.tool,
            state: c.state,
            validated: c.state === 'ok' && !c.embeddedError,
          })),
        })),
      };
      return replay;
    },
  );
}
