/**
 * VIP-care case ledger routes — the stateful work surface.
 *
 *   GET   /api/care/cases?game&playbook&status   — list (By-Playbook lens)
 *   GET   /api/care/cases/by-vip?game            — one row per VIP, deduped + priority-ranked
 *   GET   /api/care/cases/vip/:uid?game          — cross-playbook history for one user
 *   PATCH /api/care/cases/:id                    — status / assignee / treatment logging
 *
 * Writes go through the global write-role gate (editor/admin). Contact-fatigue
 * (Phase 5) layers onto the by-vip lens; here it only surfaces lastTreatedAt.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listCases,
  casesForUid,
  patchCase,
  getCase,
  type CaseStatus,
} from '../care/care-case-store.js';
import { groupCasesByVip } from '../care/care-case-engine.js';
import { playbookMetaMap, priorityRank } from '../care/playbook-merge.js';
import { resolveGameScope } from '../care/game-scope.js';
import { getVipProfiles } from '../care/care-vip-profile-store.js';
import { executeSweep, SweepBusyError } from '../care/care-sweep-execute.js';
import {
  listSweepRuns,
  getSweepRun,
  trendByPlaybook,
  diffCounts,
  diffMembers,
} from '../care/care-sweep-run-store.js';
import type { PlaybookPriority } from '../care/playbook-registry.js';
import type { WorkspaceDef } from '../services/workspaces-config-loader.js';

const STATUSES: CaseStatus[] = ['new', 'in_review', 'treated', 'resolved', 'dismissed'];

const patchSchema = z.object({
  status: z.enum(['new', 'in_review', 'treated', 'resolved', 'dismissed']).optional(),
  assignee: z.string().nullable().optional(),
  channel_used: z.string().nullable().optional(),
  action_taken: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  outcome: z.enum(['kpi_met', 'kpi_missed', 'na']).nullable().optional(),
  kpi_eval_at: z.string().nullable().optional(),
  condition_lapsed: z.boolean().optional(),
});

/** Validate `?game=` against the workspace's known games; null = invalid. */
function requireGame(workspace: WorkspaceDef, query: unknown): string | null {
  const scope = resolveGameScope(workspace, (query as { game?: string })?.game);
  return scope.ok ? (query as { game: string }).game.trim() : null;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Parse + clamp `?page`/`?pageSize`. Pagination is OPT-IN: only when a page or
 * pageSize param is present. Callers that omit both (e.g. the CS Monitor, which
 * aggregates the FULL case list) keep the un-paginated full-list behaviour — a
 * silent default cap would under-count their portfolio stats.
 */
function parsePaging(query: unknown): { page: number; pageSize: number; paginate: boolean } {
  const q = query as { page?: string; pageSize?: string };
  const paginate = q?.page != null || q?.pageSize != null;
  const page = Math.max(1, Math.floor(Number(q?.page)) || 1);
  const rawSize = Math.floor(Number(q?.pageSize)) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page, pageSize, paginate };
}

export default async function careCasesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/care/cases', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });
    const { playbook, status } = req.query as { playbook?: string; status?: string };
    if (status && !STATUSES.includes(status as CaseStatus)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `bad status "${status}"` } });
    }
    const cases = listCases({ gameId: game, playbookId: playbook, status: status as CaseStatus });
    // Paginate AFTER the store's ORDER BY opened_at DESC, then enrich only the
    // page slice — a large game has thousands of cases; enriching all per request
    // is what made the queue slow. Profiles are a SQLite read, no live Cube.
    const { page, pageSize, paginate } = parsePaging(req.query);
    const total = cases.length;
    const slice = paginate
      ? cases.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
      : cases;
    const profiles = getVipProfiles(game, req.workspace.id, slice.map((c) => c.uid));
    return {
      cases: slice.map((c) => ({ ...c, profile: profiles.get(c.uid) ?? null })),
      total,
      page,
      pageSize,
    };
  });

  app.get('/api/care/cases/by-vip', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });

    // Open cases only — resolved/dismissed leave the active queue.
    const open = listCases({ gameId: game }).filter(
      (c) => c.status !== 'resolved' && c.status !== 'dismissed',
    );
    const groups = groupCasesByVip(open);
    const meta = playbookMetaMap(game);

    const ranked = groups
      .map((g) => {
        const priorities = g.playbookIds
          .map((id) => meta[id]?.priority ?? 'tb')
          .sort((a, b) => priorityRank(a) - priorityRank(b));
        const topPriority: PlaybookPriority = priorities[0] ?? 'tb';
        return {
          ...g,
          topPriority,
          playbooks: g.playbookIds.map((id) => ({
            id,
            name: meta[id]?.name ?? id,
            priority: meta[id]?.priority ?? 'tb',
          })),
        };
      })
      // Rank queue by top-priority first, then by number of open cases. Sorting
      // BEFORE the page slice keeps urgent (cao) VIPs on page 1.
      .sort(
        (a, b) =>
          priorityRank(a.topPriority) - priorityRank(b.topPriority) ||
          b.caseCount - a.caseCount ||
          a.uid.localeCompare(b.uid),
      );

    // Slice the ranked queue, then enrich only the page with persisted profile
    // snapshots (SQLite, no live Cube) — bounds enrichment to pageSize uids.
    const { page, pageSize, paginate } = parsePaging(req.query);
    const total = ranked.length;
    const slice = paginate
      ? ranked.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
      : ranked;
    const profiles = getVipProfiles(game, req.workspace.id, slice.map((g) => g.uid));
    const vips = slice.map((g) => ({ ...g, profile: profiles.get(g.uid) ?? null }));

    return { vips, total, page, pageSize };
  });

  app.get('/api/care/cases/vip/:uid', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });
    const { uid } = req.params as { uid: string };
    const meta = playbookMetaMap(game);
    const cases = casesForUid(game, uid).map((c) => ({
      ...c,
      playbook_name: meta[c.playbook_id]?.name ?? c.playbook_id,
      playbook_priority: meta[c.playbook_id]?.priority ?? 'tb',
    }));
    return { uid, cases };
  });

  // On-demand sweep — materializes the current VIP cohort for each membership
  // playbook of `game` against the live Cube and opens/lapses cases. Editor/admin
  // (mutating; gated by the global /api/care write rule). Returns per-playbook
  // summaries so the UI can show what opened / why a playbook was skipped.
  app.post('/api/care/cases/sweep', async (req, reply) => {
    const scope = resolveGameScope(req.workspace, (req.query as { game?: string })?.game);
    if (!scope.ok) return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    const game = (req.query as { game: string }).game.trim();

    const ctx = req.buildIntrospectionCtxForGame ? req.buildIntrospectionCtxForGame(game) : req.cubeCtx;

    try {
      // Shared executor (same path the auto-sweep cron uses): members → sweep →
      // profile enrich → snapshot run. Records the run + per-uid membership.
      const r = await executeSweep(req.workspace, game, ctx, 'manual');
      return { game, opened: r.opened, lapsed: r.lapsed, profilesRefreshed: r.profilesRefreshed, summaries: r.summaries };
    } catch (err) {
      if (err instanceof SweepBusyError) {
        return reply.status(409).send({ error: { code: 'SWEEP_BUSY', message: err.message } });
      }
      // Live Cube unreachable / query failure — surface it so the button shows a
      // real error instead of a silent empty result.
      req.log.error({ err, game }, '[care] sweep failed');
      return reply.status(502).send({
        error: { code: 'SWEEP_FAILED', message: err instanceof Error ? err.message : 'sweep failed' },
      });
    }
  });

  app.patch('/api/care/cases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getCase(id)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'case not found' } });

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const b = parsed.data;
    const updated = patchCase(id, {
      status: b.status,
      assignee: b.assignee,
      channelUsed: b.channel_used,
      actionTaken: b.action_taken,
      notes: b.notes,
      outcome: b.outcome,
      kpiEvalAt: b.kpi_eval_at,
      conditionLapsed: b.condition_lapsed,
    });
    return updated;
  });

  // ── Sweep snapshot comparison (Sweeps lens) — viewer-ok reads ───────────────

  /** Both runs must belong to the validated (game, workspace) — block cross-game leakage. */
  function runInScope(runId: string, game: string, workspaceId: string): boolean {
    const r = getSweepRun(runId);
    return r != null && r.game === game && r.workspaceId === workspaceId;
  }

  // Run list for the comparison picker.
  app.get('/api/care/sweeps/runs', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });
    const limit = Math.floor(Number((req.query as { limit?: string }).limit)) || 50;
    return { runs: listSweepRuns(game, req.workspace.id, limit) };
  });

  // Cohort-size trend per playbook across runs.
  app.get('/api/care/sweeps/trend', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });
    const { playbook } = req.query as { playbook?: string };
    return { trends: trendByPlaybook(game, req.workspace.id, playbook) };
  });

  // Per-playbook count + entered/left deltas between two runs.
  app.get('/api/care/sweeps/diff', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });
    const { runA, runB } = req.query as { runA?: string; runB?: string };
    if (!runA || !runB || !runInScope(runA, game, req.workspace.id) || !runInScope(runB, game, req.workspace.id)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'runA/runB must be runs of this game' } });
    }
    return diffCounts(runA, runB);
  });

  // Paginated entered/left VIP drill for one playbook, profile-enriched.
  app.get('/api/care/sweeps/diff/vips', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });
    const q = req.query as { runA?: string; runB?: string; playbook?: string; direction?: string };
    if (!q.runA || !q.runB || !runInScope(q.runA, game, req.workspace.id) || !runInScope(q.runB, game, req.workspace.id)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'runA/runB must be runs of this game' } });
    }
    if (!q.playbook) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'playbook required' } });
    const direction = q.direction === 'left' ? 'left' : 'entered';
    const { page, pageSize } = parsePaging(req.query);
    const res = diffMembers(q.runA, q.runB, q.playbook, direction, page, pageSize);
    const profiles = getVipProfiles(game, req.workspace.id, res.uids);
    return {
      vips: res.uids.map((uid) => ({ uid, profile: profiles.get(uid) ?? null })),
      total: res.total,
      page,
      pageSize,
      membershipAvailable: res.membershipAvailable,
    };
  });
}
