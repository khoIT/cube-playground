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
    return { cases: listCases({ gameId: game, playbookId: playbook, status: status as CaseStatus }) };
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

    const enriched = groups
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
