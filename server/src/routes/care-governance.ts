/**
 * Contact-governance config + fatigue check for the VIP-care console.
 *
 *   GET /api/care/governance?game=         — current caps + cooldowns (or defaults)
 *   PUT /api/care/governance?game=         — tune caps/cooldowns (editor/admin)
 *   GET /api/care/fatigue?game&uid&channel&priority — verdict for a proposed outreach
 *
 * Writes are gated by the global /api/care write-role rule (editor/admin).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveGameScope } from '../care/game-scope.js';
import {
  getGovernance,
  upsertGovernance,
  type CareChannel,
} from '../care/care-governance-store.js';
import { checkFatigue } from '../care/fatigue.js';
import type { PlaybookPriority } from '../care/playbook-registry.js';

const CHANNELS: CareChannel[] = ['call', 'zalo_zns', 'in_game', 'push'];
const PRIORITIES: PlaybookPriority[] = ['cao', 'tb', 'thap'];

const putSchema = z.object({
  maxContactsPerWindow: z.number().int().min(1),
  windowHours: z.number().int().min(1),
  perChannelCooldownHours: z.object({
    call: z.number().min(0),
    zalo_zns: z.number().min(0),
    in_game: z.number().min(0),
    push: z.number().min(0),
  }),
});

export default async function careGovernanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/care/governance', async (req, reply) => {
    const scope = resolveGameScope(req.workspace, (req.query as { game?: string })?.game);
    if (!scope.ok) return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    return getGovernance((req.query as { game: string }).game.trim());
  });

  app.put('/api/care/governance', async (req, reply) => {
    const scope = resolveGameScope(req.workspace, (req.query as { game?: string })?.game);
    if (!scope.ok) return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    return upsertGovernance({ gameId: (req.query as { game: string }).game.trim(), ...parsed.data });
  });

  app.get('/api/care/fatigue', async (req, reply) => {
    const q = req.query as { game?: string; uid?: string; channel?: string; priority?: string };
    const scope = resolveGameScope(req.workspace, q.game);
    if (!scope.ok) return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    if (!q.uid) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'uid required' } });
    if (!q.channel || !CHANNELS.includes(q.channel as CareChannel)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `channel must be one of ${CHANNELS.join(', ')}` } });
    }
    const priority = (PRIORITIES.includes(q.priority as PlaybookPriority) ? q.priority : 'tb') as PlaybookPriority;
    return checkFatigue((q.game as string).trim(), q.uid, q.channel as CareChannel, priority);
  });
}
