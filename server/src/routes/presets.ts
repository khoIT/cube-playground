/**
 * Preset registry endpoint — returns available analysis preset definitions.
 * v1: static list; preset tab bodies live FE-side.
 */

import type { FastifyInstance } from 'fastify';
import type { Preset } from '../types/preset.js';

const PRESETS: Preset[] = [
  {
    id: 'mf_users-hub',
    label: 'mf_users hub',
    tabs: [
      { id: 'overview', label: 'Overview' },
      { id: 'engagement', label: 'Engagement' },
      { id: 'monetization', label: 'Monetization' },
      { id: 'retention', label: 'Retention' },
      { id: 'sample-users', label: 'Sample Users' },
    ],
  },
];

export default async function presetsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/presets
  app.get('/api/presets', async (_req, _reply) => {
    return PRESETS;
  });
}
