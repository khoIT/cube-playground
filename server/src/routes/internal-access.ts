/**
 * Internal service-to-service access lookup for cube-dev's `checkAuth`.
 *
 *   GET /internal/access/:key   (key = lowercased email = the Cube JWT userId)
 *     200 { role, allowedGames, status }   — active user
 *     404 { error: 'not_found' }           — unknown/inactive → cube-dev denies
 *
 * Guarded by a shared secret (`CUBE_AUTH_INTERNAL_SECRET`) in the
 * `x-internal-secret` header. NEVER exposed to browsers — network policy +
 * secret. If the secret is unset on this process, the route 503s so a
 * misconfigured deploy fails loud instead of leaking grants.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getAccess, normalizeEmail } from '../auth/access-store.js';
import { grantFallbackEnabled } from '../auth/authz-decisions.js';
import { canonicalGameId } from '../services/game-aliases.js';

function authDisabled(): boolean {
  const raw = (process.env.AUTH_DISABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

// The Cube JWT userId for the Playground service principal (queries via the
// proxy mint under the real user's email, but server-side introspection and the
// legacy token path mint under this id — see resolve-cube-token playgroundUserId).
function servicePrincipalId(): string {
  return (process.env.CUBE_PLAYGROUND_USER_ID || 'playground').toLowerCase();
}

// Legacy gds.config game ids carry a country suffix (`cfm_vn`, `jus_vn`) that
// cube-dev's checkAuth folds to a canonical id (`cfm`, `jus`) BEFORE testing
// membership of allowedGames (see cube-dev cube.js GAME_ALIASES). The test is
// `canonical(requestedGame) ∈ allowedGames`, so the list this bridge hands over
// must already be canonical — otherwise `['cfm_vn'].includes('cfm')` is false
// and a correctly-granted non-admin user is denied. Shared map keeps it in sync.

// The allowedGames this bridge should hand cube-dev's checkAuth for a resolved
// user. checkAuth is keyed by email only and has NO workspace context, so it
// can't be per-workspace — it gets the workspace-AGNOSTIC UNION of the user's
// per-workspace game grants. This is defense-in-depth only: the authoritative
// per-workspace gate runs in workspace-header BEFORE any cube token is minted,
// so the union here merely blocks a game the user holds in no workspace at all.
// Mirrors the server's game policy: an admin — or a user with no game grant in
// any workspace while grant-fallback is on — may use every game; checkAuth has
// no fallback of its own, so we emit the '*' wildcard it expands to all
// supported games. Concrete grants are canonicalized to match the post-alias id
// checkAuth compares against.
function allowedGamesFor(role: string, gamesByWorkspace: Record<string, string[]>): string[] {
  if (role === 'admin') return ['*'];
  const union = [...new Set(Object.values(gamesByWorkspace).flat())];
  if (union.length === 0 && grantFallbackEnabled()) return ['*'];
  return [...new Set(union.map(canonicalGameId))];
}

async function internalSecretGate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Break-glass: with auth off the whole app runs as a synth admin (see
  // authenticate.ts) and the SSO wall is down. Open this bridge to match, so
  // the in-stack cube's checkAuth resolves the same way local dev does — the
  // handler returns an all-games admin below. Skipping the secret gate is safe
  // here precisely because the deploy already chose to disable authz.
  if (authDisabled()) return;
  const expected = process.env.CUBE_AUTH_INTERNAL_SECRET ?? '';
  if (!expected) {
    reply.status(503).send({ error: 'internal_secret_not_configured' });
    return;
  }
  const provided = req.headers['x-internal-secret'];
  if (typeof provided !== 'string' || provided !== expected) {
    reply.status(401).send({ error: 'invalid_internal_secret' });
    return;
  }
}

export default async function internalAccessRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { key: string } }>(
    '/internal/access/:key',
    { preHandler: internalSecretGate },
    async (req, reply) => {
      // Auth off → resolve every principal as an all-games admin, mirroring the
      // server's synth admin. '*' is a wildcard the cube's checkAuth expands to
      // all supported tenants, so we don't have to translate game-id vocab
      // (gds.config `cfm_vn` vs cube canonical `cfm`) here. Unreachable when
      // AUTH_DISABLED is unset/false.
      if (authDisabled()) {
        return { role: 'admin', allowedGames: ['*'], status: 'active' };
      }
      const key = normalizeEmail(req.params.key);
      // Service principal: minted by THIS server only after it has already
      // enforced the requesting user's workspace/game access (workspace-header).
      // It carries no user identity to resolve and is never a grant row, so the
      // cube trusts it as a service account → all-games admin. Without this,
      // server-side introspection (the identity map behind the row-selection
      // column) and the legacy token path 404 under real auth.
      if (key === servicePrincipalId()) {
        return { role: 'admin', allowedGames: ['*'], status: 'active' };
      }
      const access = getAccess(key);
      // Fail closed: only active users resolve; everything else is "no access".
      if (!access || access.status !== 'active') {
        return reply.status(404).send({ error: 'not_found' });
      }
      return {
        role: access.role,
        allowedGames: allowedGamesFor(access.role, access.gamesByWorkspace),
        status: access.status,
      };
    },
  );
}
