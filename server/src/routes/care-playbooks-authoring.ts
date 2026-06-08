/**
 * Playbook Builder write endpoints (Phase 6) — CS authoring over the override
 * layer. Seeds (the 21 canonical playbooks) live in code and are never stored,
 * so they can't be deleted here — only overridden (base_id set) or disabled
 * (override with enabled=false). Net-new playbooks have base_id null.
 *
 *   POST   /api/care/playbooks       — create override or net-new
 *   PATCH  /api/care/playbooks/:id   — edit an override row
 *   DELETE /api/care/playbooks/:id   — remove an override/net-new row (reverts to seed)
 *
 * All gated to editor/admin by the global /api/care write-role rule.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveGameScope } from '../care/game-scope.js';
import { getSeedPlaybook } from '../care/playbook-registry.js';
import {
  createOverride,
  updateOverride,
  deleteOverride,
  getOverride,
} from '../care/care-playbooks-store.js';

const thresholdRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('abs'), member: z.string().min(1), op: z.enum(['gt', 'lt', 'gte', 'lte', 'equals']), value: z.number(), valueType: z.enum(['string', 'number', 'time', 'boolean']).optional() }),
  z.object({ kind: z.literal('tierStep'), member: z.string().min(1), bands: z.array(z.object({ label: z.string(), min: z.number() })).min(1) }),
  z.object({ kind: z.literal('event'), member: z.string().min(1), window: z.string().min(1) }),
  z.object({ kind: z.literal('percentile'), of: z.string().min(1), p: z.number().min(0).max(100), gate: z.string().optional() }),
  z.object({ kind: z.literal('ratio'), member: z.string().min(1), vs: z.string().min(1), value: z.number(), op: z.enum(['gt', 'lt', 'gte', 'lte']) }),
]);

const watchedMetricSchema = z.object({ member: z.string(), label: z.string(), kpiTarget: z.string().optional() });
const actionSchema = z.object({ text: z.string(), channels: z.array(z.string()), slaMinutes: z.number().optional() });

const createSchema = z.object({
  base_id: z.string().nullable().optional(),
  name: z.string().min(1),
  group: z.enum(['payment', 'ingame', 'churn', 'event']),
  priority: z.enum(['cao', 'tb', 'thap']),
  condition: thresholdRuleSchema,
  watchedMetric: watchedMetricSchema,
  action: actionSchema,
  dataRequirements: z.array(z.string()),
  enabled: z.boolean().optional(),
});

const patchSchema = createSchema.partial();

export default async function carePlaybooksAuthoringRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/care/playbooks', async (req, reply) => {
    const scope = resolveGameScope(req.workspace, (req.query as { game?: string })?.game);
    if (!scope.ok) return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    // An override must target a real seed; a bad base_id would create an orphan
    // override that never merges onto anything.
    if (parsed.data.base_id && !getSeedPlaybook(parsed.data.base_id)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `unknown seed base_id "${parsed.data.base_id}"` } });
    }
    const created = createOverride({
      gameId: (req.query as { game: string }).game.trim(),
      baseId: parsed.data.base_id ?? null,
      name: parsed.data.name,
      group: parsed.data.group,
      priority: parsed.data.priority,
      condition: parsed.data.condition,
      watchedMetric: parsed.data.watchedMetric,
      action: parsed.data.action,
      dataRequirements: parsed.data.dataRequirements,
      enabled: parsed.data.enabled,
      owner: req.user?.email,
    });
    return reply.status(201).send(created);
  });

  app.patch('/api/care/playbooks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getOverride(id)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'override not found' } });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { base_id, ...rest } = parsed.data;
    return updateOverride(id, { ...rest, baseId: base_id ?? undefined });
  });

  app.delete('/api/care/playbooks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteOverride(id)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'override not found' } });
    }
    return reply.status(204).send();
  });
}
