/**
 * Public auth surface backing the Keycloak SSO flow.
 *
 *   GET  /api/auth/keycloak/config    → enabled flag + KC URLs for the FE redirect
 *   POST /api/auth/keycloak/callback  → exchange ?code= for an app JWT
 *   GET  /api/auth/me                 → echo current user (from Bearer JWT)
 *   POST /api/auth/logout             → server-side no-op; FE drops the token
 *
 * All routes are intentionally NOT behind requireRole — the config + callback
 * MUST be reachable to the unauthenticated browser. /me + /logout return 401
 * via authenticate.ts when no token is present.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getDb } from '../db/sqlite.js';
import { signAppJwt } from '../services/app-jwt.js';
import { exchangeKeycloakCode } from '../services/keycloak-token-exchange.js';
import { upsertUser } from '../services/users-store.js';
import { getAccess } from '../auth/access-store.js';
import { ensurePendingUser, reconcileSub } from '../auth/access-store-mutators.js';

const callbackBody = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

function authDisabled(): boolean {
  const raw = (process.env.AUTH_DISABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/keycloak/config', async () => {
    if (authDisabled()) {
      // FE reads `enabled=false` and skips the SSO redirect entirely.
      return { enabled: false };
    }
    const kcUrl = (process.env.KEYCLOAK_URL ?? '').replace(/\/+$/, '');
    const realm = process.env.KEYCLOAK_REALM ?? '';
    const clientId = process.env.KEYCLOAK_CLIENT_ID ?? '';
    if (!kcUrl || !realm || !clientId) {
      // Misconfigured — surface enabled=false so the UI doesn't try to
      // redirect to an empty URL. Server log carries the diagnostics.
      app.log.warn('Keycloak config incomplete; auth flow disabled');
      return { enabled: false };
    }
    const realmBase = `${kcUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect`;
    return {
      enabled: true,
      authUrl: `${realmBase}/auth`,
      tokenUrl: `${realmBase}/token`,
      logoutUrl: `${realmBase}/logout`,
      clientId,
      realm,
    };
  });

  app.post('/api/auth/keycloak/callback', async (request, reply) => {
    if (authDisabled()) {
      return reply.status(400).send({ error: 'AUTH_DISABLED — Keycloak flow not enabled' });
    }
    const parse = callbackBody.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parse.error.flatten() });
    }

    let claims;
    try {
      claims = await exchangeKeycloakCode(parse.data);
    } catch (err) {
      app.log.warn({ err }, 'Keycloak code exchange failed');
      return reply.status(401).send({ error: 'Keycloak code exchange failed' });
    }

    const username = claims.preferred_username ?? claims.sub;
    const email = claims.email;

    // Default-deny: authentication (KC/Microsoft) does NOT imply authorization.
    // Without an email we cannot key the grant, and without an active grant the
    // user is authenticated-but-unauthorized.
    if (!email) {
      return reply.status(403).send({ error: 'ACCESS_PENDING', reason: 'no_email' });
    }

    const access = getAccess(email);
    if (!access || access.status !== 'active') {
      // Auto-create a pending row (reconciles sub) so the user surfaces in the
      // admin approval queue. No privileged JWT is minted.
      ensurePendingUser(email, claims.sub);
      // Audit the login attempt (role mirrors the pending/known row).
      upsertUser(getDb(), {
        id: claims.sub,
        username,
        email,
        role: access?.role ?? 'viewer',
      });
      const status = access?.status ?? 'pending';
      return reply.status(403).send({ error: 'ACCESS_PENDING', status });
    }

    // Active user → reconcile sub, audit, mint app JWT with DB role.
    if (!access.kcSub) reconcileSub(email, claims.sub);
    upsertUser(getDb(), { id: claims.sub, username, email, role: access.role });

    const token = await signAppJwt({
      sub: claims.sub,
      username,
      email,
      role: access.role,
    });

    return {
      token,
      user: {
        id: claims.sub,
        username,
        email,
        role: access.role,
        allowedGames: access.games,
      },
    };
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Not authenticated' });
    return { user: request.user };
  });

  app.post('/api/auth/logout', async () => {
    // Token revocation is stateless on the server side — the FE clears its
    // localStorage entry, and any in-flight JWT expires per JWT_EXPIRES_MINUTES.
    // (KC `end_session_endpoint` is invoked by the FE for the SSO logout.)
    return { ok: true };
  });
}
