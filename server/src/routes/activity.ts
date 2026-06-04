/**
 * Activity beacon — the FE posts UI-observable events here so they land on the
 * telemetry spine. These are client-driven actions (a feature page opened, a
 * chart/query exported, a workspace switched) that aren't a single server
 * request, so the SPA reports them explicitly.
 *
 * Spoofing boundary: only the CLIENT_EMITTABLE event types are accepted here.
 * `query_run` and `segment_op` are server-emitted exclusively (from the cube
 * proxy and segment routes) so a client can never forge them. `feature_open`
 * additionally validates its target against the closed `FEATURE_KEYS` registry.
 *
 * Auth: rides the normal authenticate/workspace middleware; the actor is
 * `req.principal` (sub-keyed), never a client-supplied identity.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordActivity } from '../services/activity-store.js';
import { isFeatureKey } from '../auth/feature-keys.js';
import type { ActivityEventType } from '../services/activity-event-types.js';

/** Event types a browser client is allowed to report. Server-only events
 *  (query_run, segment_op) are deliberately excluded — they can't be forged.
 *  `cube_outage` is inherently client-observed (only the browser knows whether
 *  its view of the backend is reachable), so it must be client-emitted; the
 *  phase is constrained to a two-value enum below to bound the trust. */
const CLIENT_EMITTABLE: ReadonlySet<ActivityEventType> = new Set<ActivityEventType>([
  'feature_open',
  'export',
  'workspace_switch',
  'cube_outage',
]);

/** Cube reachability transitions the client may report. */
const OUTAGE_PHASES = ['unreachable', 'recovered'] as const;

const beaconSchema = z.object({
  eventType: z.enum(['feature_open', 'export', 'workspace_switch', 'cube_outage']),
  targetType: z.string().min(1).max(64).optional(),
  targetId: z.string().min(1).max(256).optional(),
  // cube_outage only: how long the outage lasted (sent on the 'recovered' edge).
  // Capped at 24h so a bad client clock can't write an absurd duration.
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
});

export default async function activityRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/activity  { eventType, targetType?, targetId? }
  app.post('/api/activity', async (req, reply) => {
    const parsed = beaconSchema.safeParse(req.body);
    if (!parsed.success || !CLIENT_EMITTABLE.has(parsed.data.eventType)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid activity event' } });
    }
    const { eventType, targetType, targetId, durationMs } = parsed.data;

    // feature_open carries a feature key — reject anything outside the registry
    // so the event vocabulary can't be widened by an arbitrary string.
    if (eventType === 'feature_open' && (!targetId || !isFeatureKey(targetId))) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Unknown feature key' } });
    }

    // cube_outage carries the transition phase in targetId — constrain it to the
    // known edges so the event can't be widened by an arbitrary string.
    if (eventType === 'cube_outage' && !(OUTAGE_PHASES as readonly string[]).includes(targetId ?? '')) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Unknown outage phase' } });
    }

    recordActivity(req.principal, {
      eventType,
      targetType:
        targetType ??
        (eventType === 'feature_open' ? 'feature' : eventType === 'cube_outage' ? 'cube_api' : null),
      targetId: targetId ?? null,
      workspace: req.workspace.id,
      // Only the 'recovered' edge carries a duration; persisted for outage stats.
      detail: eventType === 'cube_outage' && durationMs != null ? { durationMs } : undefined,
    });

    return reply.status(202).send({ recorded: true });
  });
}
