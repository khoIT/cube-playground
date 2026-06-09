/**
 * Playbook preview-count route — a READ-ONLY dry run of a candidate condition.
 *
 *   POST /api/care/playbooks/:id/preview-count?game=<id>
 *
 * Given an edited threshold condition (+ optional supplemental filter), returns
 * how many VIPs it would match against the LIVE Cube — WITHOUT opening any case,
 * recording a run, or enriching a profile. The count is the cohort the real
 * sweep would open for the same condition: it runs the candidate through the
 * exact same compile/gate/fetch pipeline (`mergePlaybooks` → VIP-base-gated
 * `makeCubeCohortFetcher`), so a previewed number can't drift from a swept one.
 *
 * `:id` is the playbook being edited (seed id, override id, or "new"). The
 * candidate is resolved as a transient custom playbook (never persisted), so
 * availability + percentile calibration apply identically to a saved playbook.
 *
 * Editor/admin only (POST under /api/care → global write-role gate). The game
 * param is bounded by resolveGameScope, like the registry route.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveGameScope } from '../care/game-scope.js';
import { getGameMembers } from '../care/availability.js';
import { mergePlaybooks } from '../care/playbook-merge.js';
import { loadCalibration } from '../care/calibrate.js';
import { ruleMembers, type ThresholdRule } from '../care/threshold-rule.js';
import { makeCubeCohortFetcher, VIP_LTV_MEMBER } from '../care/care-case-sweep.js';
import { treeToCubeFilters } from '../services/translator.js';
import type { CarePlaybookOverride } from '../care/care-playbooks-store.js';
import type { PredicateNode } from '../types/predicate-tree.js';
import { thresholdRuleSchema, predicateNodeSchema } from './care-playbook-validation.js';

const bodySchema = z.object({
  condition: thresholdRuleSchema,
  supplementalPredicate: predicateNodeSchema.nullable().optional(),
});

/** Every leaf member referenced in a predicate tree (for dataRequirements). */
function predicateMembers(node: PredicateNode): string[] {
  if (node.kind === 'leaf') return [node.member];
  return node.children.flatMap(predicateMembers);
}

export default async function carePlaybookPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/care/playbooks/:id/preview-count', async (req, reply) => {
    const scope = resolveGameScope(req.workspace, (req.query as { game?: string })?.game);
    if (!scope.ok) return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    const game = (req.query as { game: string }).game.trim();

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const condition = parsed.data.condition as ThresholdRule;
    const supplemental = (parsed.data.supplementalPredicate ?? undefined) as PredicateNode | undefined;
    const editedId = (req.params as { id: string }).id;

    const ctx = req.buildIntrospectionCtxForGame ? req.buildIntrospectionCtxForGame(game) : req.cubeCtx;
    const cacheKey = `${req.workspace.id}:${game}`;

    let members: Set<string>;
    try {
      // Fresh member set, like the sweep — availability gating must reflect the
      // live model, not a cached probe.
      members = await getGameMembers(ctx, scope.gamePrefix, cacheKey, true);
    } catch (err) {
      req.log.error({ err, game }, '[care] preview-count members failed');
      return reply.status(502).send({ error: { code: 'PREVIEW_FAILED', message: 'live model unreachable' } });
    }

    // dataRequirements drives both availability and the cube the cohort fetcher
    // queries (it reads dataRequirements[0]) — derive it from the condition's
    // members first, then any supplemental-filter leaves (mirrors the builder).
    const dataRequirements = [
      ...ruleMembers(condition),
      ...(supplemental ? predicateMembers(supplemental) : []),
    ].filter((m, i, a) => m && a.indexOf(m) === i);

    // Transient, never-persisted custom playbook. baseId:null → it resolves as a
    // `custom` row whose id equals our synthetic id, so we can pick it back out
    // and key its calibration without colliding with the real registry.
    const synthId = `__preview__${editedId}`;
    const now = new Date().toISOString();
    const transient: CarePlaybookOverride = {
      id: synthId,
      gameId: game,
      baseId: null,
      name: '(preview)',
      group: 'event',
      priority: 'tb',
      condition,
      watchedMetric: { member: '', label: '' },
      action: { text: '', channels: [] },
      dataRequirements,
      supplementalPredicate: supplemental,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    // Carry over the edited playbook's calibration (percentile rules need their
    // resolved cutoff) under the synthetic id so compileRule behaves as it would
    // for the real playbook.
    const calForEdited = editedId !== 'new' ? loadCalibration(game)[editedId] : undefined;
    const resolved = mergePlaybooks(game, members, [transient], {
      calibration: calForEdited ? { [synthId]: calForEdited } : {},
    }).find((p) => p.id === synthId);

    if (!resolved) {
      return reply.status(500).send({ error: { code: 'PREVIEW_FAILED', message: 'candidate did not resolve' } });
    }

    const gated = members.has(VIP_LTV_MEMBER);

    // Unavailable → the playbook's members aren't in this game's live model; the
    // real sweep would skip it, so there's nothing to count.
    if (resolved.availability === 'unavailable') {
      return reply.status(409).send({
        error: { code: 'PLAYBOOK_UNAVAILABLE', message: 'condition references members absent from this game' },
      });
    }
    // Ratio rules evaluate per-member (no static cohort) and uncalibrated
    // percentiles have no predicate — neither yields a count.
    if (resolved.evalMode === 'trigger' || !resolved.predicate) {
      return { matched: 0, gated, note: resolved.compileReason ?? 'no cohort predicate for this rule' };
    }
    // Fail-closed: a predicate that compiles to no Cube filter would match the
    // entire VIP base via the gate alone. Never report that as a real count.
    if (treeToCubeFilters(resolved.predicate).length === 0) {
      return { matched: 0, gated, note: 'condition compiled to an empty filter' };
    }

    try {
      const fetchCohort = makeCubeCohortFetcher(ctx, game, req.workspace.id, members);
      const t0 = Date.now();
      const { uids } = await fetchCohort(resolved);
      return { matched: uids.length, elapsedMs: Date.now() - t0, gated };
    } catch (err) {
      req.log.error({ err, game, editedId }, '[care] preview-count query failed');
      return reply.status(502).send({ error: { code: 'PREVIEW_FAILED', message: err instanceof Error ? err.message : 'preview failed' } });
    }
  });
}
