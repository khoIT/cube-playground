/**
 * OpenAPI 3 spec + Scalar interactive reference for the public export API.
 *
 * `registerSwagger` runs BEFORE route registration so @fastify/swagger collects
 * each public route's `schema` block. Only `tags:['public']` operations surface
 * (`hideUntagged: true` hides every internal route — none carry tags), so the
 * spec never leaks the internal surface.
 *
 * `registerDocs` runs AFTER routes: it serves the raw spec at /openapi.json and
 * the Scalar UI at /docs (both public — auth is still enforced at call time).
 */

import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import { publicApiBaseUrl } from '../services/public-segment-dto.js';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Segment Export API',
        version: '1.0.0',
        description:
          'Documented, API-key-secured streaming export of full segment cohorts. ' +
          'Read the completion contract on the members endpoint before building a ' +
          'consumer — a 200 is necessary but not sufficient.',
      },
      servers: [{ url: publicApiBaseUrl(), description: 'Production (VPN)' }],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'sk_live_…',
            description: 'Service API key minted by an admin. Send as Authorization: Bearer sk_live_…',
          },
        },
      },
    },
    // Only documented (tagged) operations appear; internal routes are untagged.
    hideUntagged: true,
  });
}

export async function registerDocs(app: FastifyInstance): Promise<void> {
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(scalar, {
    routePrefix: '/docs',
    configuration: {
      url: '/openapi.json',
      // Calm, single-column theme that reads like reference docs.
      theme: 'default',
    },
  });
}
