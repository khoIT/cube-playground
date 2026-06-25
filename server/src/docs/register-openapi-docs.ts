/**
 * OpenAPI 3 spec + Scalar interactive reference for the public export API.
 *
 * `registerSwagger` runs BEFORE route registration so @fastify/swagger collects
 * each public route's `schema` block. Only `tags:['public']` operations surface
 * (`hideUntagged: true` hides every internal route — none carry tags), so the
 * spec never leaks the internal surface.
 *
 * `registerDocs` runs AFTER routes: it serves the raw spec at /openapi.json and
 * TWO interactive renderers off that one spec — Scalar at /docs (primary) and
 * Swagger UI at /docs/swagger (the flow external integrators expect). Both are
 * public; auth is still enforced at call time.
 */

import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import scalar from '@scalar/fastify-api-reference';
import { publicApiBaseUrl } from '../services/public-segment-dto.js';

// Long-form consumer integration guide (completion contract, auth, cursor
// resume, rate limits). Wired into the spec's externalDocs so BOTH renderers
// surface it as a top-level link — set once here, never per-renderer.
const CONSUMER_GUIDE_URL = 'https://claude.ai/code/artifact/ee7ccec9-5c26-4685-a4cc-9e6c2b29a0f0';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  // Prod first (the canonical base). Outside production, also offer the local
  // dev origin so the Scalar "Try it" client can target this machine through
  // the vite proxy instead of the (VPN-only) prod host.
  const servers = [{ url: publicApiBaseUrl(), description: 'Production (VPN)' }];
  if (process.env.NODE_ENV !== 'production') {
    servers.push({
      url: process.env.DEV_WEB_ORIGIN ?? 'http://localhost:3000',
      description: 'Local dev (vite proxy → server)',
    });
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Segment Export API',
        version: '1.0.0',
        description:
          'Documented, API-key-secured streaming export of full segment cohorts. ' +
          'Read the completion contract on the members endpoint before building a ' +
          'consumer — a 200 is necessary but not sufficient. ' +
          `Full integration guide: ${CONSUMER_GUIDE_URL}`,
      },
      externalDocs: {
        url: CONSUMER_GUIDE_URL,
        description: 'Consumer integration guide (completion contract, auth, resume, rate limits)',
      },
      servers,
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

  // Scalar — primary, polished reference at /docs.
  await app.register(scalar, {
    routePrefix: '/docs',
    configuration: {
      url: '/openapi.json',
      // Calm, single-column theme that reads like reference docs.
      theme: 'default',
    },
  });

  // Swagger UI — the classic "Authorize 🔓 + Try it" flow external integrators
  // expect, served off the SAME spec at /docs/swagger.
  await app.register(swaggerUi, {
    routePrefix: '/docs/swagger',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}
