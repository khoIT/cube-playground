/**
 * Route-level feature gate. Use as a Fastify preHandler to hard-deny access to
 * a feature-scoped route when the user's resolved feature map doesn't grant it:
 *
 *   app.register(adminRoutes, { ... })  // each route: preHandler: requireFeature('admin')
 *
 * Enforcement (not cosmetic): the FE may also hide the nav entry, but THIS is
 * the real gate. Skipped under AUTH_DISABLED (dev) where the synth admin holds
 * every feature anyway.
 */

import type { preHandlerHookHandler } from 'fastify';

import { userHasFeature } from '../auth/authz-decisions.js';
import type { FeatureKey } from '../auth/feature-keys.js';

function authDisabled(): boolean {
  const raw = (process.env.AUTH_DISABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function requireFeature(key: FeatureKey): preHandlerHookHandler {
  return async (request, reply) => {
    if (authDisabled()) return;
    if (!request.user) return reply.status(401).send({ error: 'Not authenticated' });
    if (!userHasFeature(request.user, key)) {
      return reply.status(403).send({
        error: { code: 'FEATURE_FORBIDDEN', feature: key },
      });
    }
  };
}
