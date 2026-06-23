/**
 * Public auth surface backing the Keycloak SSO flow (keycloak-js front door).
 *
 *   GET  /api/auth/keycloak/config    → enabled flag + raw KC coords for keycloak-js
 *   POST /api/auth/keycloak/session   → verify KC id_token, mint an app JWT
 *   GET  /api/auth/me                 → echo current user (from Bearer JWT)
 *   POST /api/auth/logout             → server-side no-op; FE drops the token
 *
 * All routes are intentionally NOT behind requireRole — the config + session
 * MUST be reachable to the unauthenticated browser. /me + /logout return 401
 * via authenticate.ts when no token is present.
 *
 * keycloak-js owns the OIDC + PKCE handshake in the browser; the server no
 * longer does a code exchange. The browser hands us the realm-signed id_token,
 * which we JWKS-verify before trusting any claim.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getDb } from '../db/sqlite.js';
import { signAppJwt } from '../services/app-jwt.js';
import { verifyKeycloakIdToken } from '../services/keycloak-id-token-verify.js';
import { upsertUser } from '../services/users-store.js';
import { getAccess } from '../auth/access-store.js';
import { ensurePendingUser, reconcileSub } from '../auth/access-store-mutators.js';

const sessionBody = z.object({
  idToken: z.string().min(1),
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
      // init keycloak-js with empty coords. Server log carries the diagnostics.
      app.log.warn('Keycloak config incomplete; auth flow disabled');
      return { enabled: false };
    }
    // keycloak-js builds its own endpoint URLs from {url, realm, clientId}.
    // idpHint (optional) routes the login straight to a brokered IdP (e.g. SAML)
    // instead of showing Keycloak's IdP-picker page.
    return {
      enabled: true,
      url: kcUrl,
      realm,
      clientId,
      idpHint: process.env.KEYCLOAK_IDP_HINT || undefined,
    };
  });

  app.post('/api/auth/keycloak/session', async (request, reply) => {
    if (authDisabled()) {
      return reply.status(400).send({ error: 'AUTH_DISABLED — Keycloak flow not enabled' });
    }
    const parse = sessionBody.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parse.error.flatten() });
    }

    let claims;
    try {
      claims = await verifyKeycloakIdToken(parse.data.idToken);
    } catch (err) {
      app.log.warn({ err }, 'Keycloak id_token verification failed');
      return reply.status(401).send({ error: 'Keycloak id_token verification failed' });
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
        gamesByWorkspace: access.gamesByWorkspace,
        // Parity with /api/auth/me so the FE has the full grant set immediately
        // after login — feature gating + workspace filtering work on first paint
        // without waiting for a /me refresh.
        workspaces: access.workspaces,
        features: access.features,
      },
    };
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Not authenticated' });
    // Dev mode never runs the Keycloak session POST (the only other place
    // last_login is written), so /me — hit on every app bootstrap — is the
    // dev analog of "last seen". Touch it here so the admin vitals aren't
    // frozen at the last real login. Real-auth keeps its login-only semantics.
    if (authDisabled()) {
      const u = request.user;
      upsertUser(getDb(), { id: u.id, username: u.username, email: u.email, role: u.role });
    }
    return { user: request.user };
  });

  app.post('/api/auth/logout', async () => {
    // Token revocation is stateless on the server side — the FE clears its
    // localStorage entry, and any in-flight JWT expires per JWT_EXPIRES_MINUTES.
    // (KC `end_session_endpoint` is invoked by the FE for the SSO logout.)
    return { ok: true };
  });
}
