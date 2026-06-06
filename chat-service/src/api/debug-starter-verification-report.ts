/**
 * GET /debug/starter-verification-report
 *
 * Serves seed/starter-verification-report.json — the per-candidate results
 * the pregenerate→verify workflow writes (tier-1 query gate + tier-2 real
 * chat turn, kept and failed alike). Rendered by the FE review tab at
 * /dev/chat-audit/starters so the pregenerated question set can be audited
 * without manually re-asking each question.
 *
 * 404 = no verification run recorded on this machine (the file is a local
 * workflow artifact, gitignored).
 */

import type { FastifyPluginAsync } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { STARTER_SEED_PATH } from '../db/starter-questions-seed.js';

const REPORT_PATH = STARTER_SEED_PATH.replace(
  /starter-questions-seed\.json$/,
  'starter-verification-report.json',
);

const debugStarterVerificationReportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/debug/starter-verification-report', async (_req, reply) => {
    if (!existsSync(REPORT_PATH)) {
      return reply.status(404).send({ error: 'No verification run recorded' });
    }
    try {
      const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
      return reply.send(report);
    } catch {
      return reply.status(404).send({ error: 'Verification report unreadable' });
    }
  });
};

export default debugStarterVerificationReportRoutes;
