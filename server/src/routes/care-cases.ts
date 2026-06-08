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
import { getGameMembers } from '../care/availability.js';
import { loadCalibration } from '../care/calibrate.js';
import { runCaseSweep, makeCubeCohortFetcher } from '../care/care-case-sweep.js';
import { getVipProfiles, upsertVipProfiles } from '../care/care-vip-profile-store.js';
import { makeCubeProfileFetcher } from '../care/care-vip-profile-fetch.js';
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

export default async function careCasesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/care/cases', async (req, reply) => {
    const game = requireGame(req.workspace, req.query);
    if (!game) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game required' } });
    const { playbook, status } = req.query as { playbook?: string; status?: string };
    if (status && !STATUSES.includes(status as CaseStatus)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `bad status "${status}"` } });
    }
    const cases = listCases({ gameId: game, playbookId: playbook, status: status as CaseStatus });
    // Enrich each case with the persisted VIP profile (name / LTV) — SQLite read,
    // no live Cube. Missing snapshot (un-swept) → field absent, client shows uid.
    const profiles = getVipProfiles(game, req.workspace.id, cases.map((c) => c.uid));
    return { cases: cases.map((c) => ({ ...c, profile: profiles.get(c.uid) ?? null })) };
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
    // Persisted profile snapshots for the queue's uids (SQLite, no live Cube).
    const profiles = getVipProfiles(game, req.workspace.id, groups.map((g) => g.uid));

    const enriched = groups
      .map((g) => {
        const priorities = g.playbookIds
          .map((id) => meta[id]?.priority ?? 'tb')
          .sort((a, b) => priorityRank(a) - priorityRank(b));
        const topPriority: PlaybookPriority = priorities[0] ?? 'tb';
        return {
          ...g,
          topPriority,
          profile: profiles.get(g.uid) ?? null,
          playbooks: g.playbookIds.map((id) => ({
            id,
            name: meta[id]?.name ?? id,
            priority: meta[id]?.priority ?? 'tb',
          })),
        };
      })
      // Rank queue by top-priority first, then by number of open cases.
      .sort(
        (a, b) =>
          priorityRank(a.topPriority) - priorityRank(b.topPriority) ||
          b.caseCount - a.caseCount ||
          a.uid.localeCompare(b.uid),
      );

    return { vips: enriched };
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
    const cacheKey = `${req.workspace.id}:${game}`;

    try {
      // Force a fresh member set so gating reflects the live model, not a cached probe.
      const members = await getGameMembers(ctx, scope.gamePrefix, cacheKey, true);
      const deps = { fetchCohortUids: makeCubeCohortFetcher(ctx, game, req.workspace.id, members) };
      const summaries = await runCaseSweep(game, req.workspace.id, members, deps, loadCalibration(game));
      const opened = summaries.reduce((n, s) => n + s.opened, 0);
      const lapsed = summaries.reduce((n, s) => n + s.lapsed, 0);

      // Persist VIP profile snapshots for every open case so the queue reads them
      // from SQLite. Best-effort: a profile-fetch failure must not fail the sweep.
      let profilesRefreshed = 0;
      try {
        const openUids = [...new Set(
          listCases({ gameId: game })
            .filter((c) => c.status !== 'resolved' && c.status !== 'dismissed')
            .map((c) => c.uid),
        )];
        if (openUids.length > 0) {
          const snapshots = await makeCubeProfileFetcher(ctx, game, req.workspace.id)(openUids);
          upsertVipProfiles(game, req.workspace.id, snapshots);
          profilesRefreshed = snapshots.length;
        }
      } catch (perr) {
        req.log.warn({ perr, game }, '[care] profile enrichment failed (cases still swept)');
      }

      return { game, opened, lapsed, profilesRefreshed, summaries };
    } catch (err) {
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
}
