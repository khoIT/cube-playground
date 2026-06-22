# Keycloak-js + SAML migration (login.gio.vng.vn, no-VPN)

**Date:** 2026-06-22
**Goal:** Replace old VPN Keycloak with the new no-VPN instance, using the `keycloak-js`
adapter (public client + PKCE/S256) brokering to the SAML IdP, while preserving the
existing server-minted app-JWT + SQLite default-deny authz model unchanged.

## Decisions (locked by user 2026-06-22)
- Client `playground-gds` = **public + PKCE S256** (no client secret).
- Integration = **migrate to keycloak-js** (not hand-rolled OIDC).
- JWKS verify = **ENABLED on the new session-establish endpoint** (user confirmed
  2026-06-22, R1 surfaced). Token now arrives from the browser, so signature must be
  verified against the realm certs before trusting claims.
- Start now using snippet values: redirect = root `https://playground.gds.vng.vn/`,
  idpHint=`saml`. Reconcile with realm config when platform team confirms.

## Config delta (env / Vault `jupyter/prod/khoitn/cube-playground`)
```
KEYCLOAK_URL=https://login.gio.vng.vn        # was gio-gds-keycloak.vnggames.net:4430
KEYCLOAK_REALM=GS                            # unchanged
KEYCLOAK_CLIENT_ID=playground-gds            # was 'playground'
KEYCLOAK_CLIENT_SECRET=                      # remove — public client
KEYCLOAK_IDP_HINT=saml                       # NEW: route straight to SAML IdP
```
Mirror in `.env`, `.env.docker.local`. Old values kept in `.env.bak.*`.

## Realm-side prerequisites (platform team, NOT this repo)
`playground-gds` client in realm `GS` must have:
- Access type **public**, Standard flow on, PKCE S256 required.
- Valid redirect URIs: `https://playground.gds.vng.vn/*` (root, keycloak-js style).
- Web origins: `https://playground.gds.vng.vn` (+ `http://localhost:3000` for dev).
- SAML IdP brokered, alias = `saml` (matches idpHint).
- Mappers: keep `email`, `preferred_username`; `groups` optional (authz is app-side).

## Architecture: what changes vs. what stays
| Layer | Today | After |
|---|---|---|
| FE front door | hand-rolled authorize URL + `/auth/callback` POST | `keycloak-js` init(check-sso) + `login({idpHint})` |
| Token to server | server does code-exchange | FE sends KC access token once to `/api/auth/keycloak/session` |
| App JWT | minted after exchange | minted after **JWKS-verified** KC token — UNCHANGED downstream |
| DB authz / default-deny / RBAC / grants | SQLite | **UNCHANGED** |
| Cube token minting (userId=email) | server | **UNCHANGED** |
| `/api/auth/keycloak/callback` (code POST) | exists | **removed** (keycloak-js owns the callback) |

## Status — IMPLEMENTED 2026-06-22 (code complete; realm config + prod cutover pending)
All 5 phases landed. Server+FE typecheck clean; default-deny test (now session
endpoint, 5/5) + FE auth tests (29/29) pass. Blocked only on platform-team realm
config + Vault values for prod cutover. Files changed:
- FE: `src/auth/auth-context.tsx` (keycloak-js), `auth-storage.ts` (comment),
  `public/silent-check-sso.html` (new), `package.json` (+keycloak-js@^26).
- Server: `routes/auth.ts` (config returns url/realm/clientId/idpHint; session
  endpoint replaces callback), `services/keycloak-id-token-verify.ts` (new, JWKS),
  removed `services/keycloak-token-exchange.ts`.
- Config: `.env`, `.env.docker.local`, `.env.docker.local.example`,
  `keycloak/realm-export.json` (local client → root redirect + PKCE).
- Tests: `server/test/auth-callback-default-deny.test.ts` → session endpoint.
- Docs: `deployment-guide.md`, `lessons-learned.md`.

## Phases
1. **Deps + config** — add `keycloak-js`; set env/Vault values; add `KEYCLOAK_IDP_HINT`.
   Update `/api/auth/keycloak/config` to also return `url`, `realm` (keycloak-js needs raw).
2. **FE rewrite** `src/auth/auth-context.tsx` — replace buildAuthorizeUrl/callback handling
   with keycloak-js: `init({onLoad:'check-sso', pkceMethod:'S256'})`, `login({idpHint})`,
   silent refresh, `logout()`. On authenticated, POST `keycloak.token` → session endpoint →
   store returned app JWT (keep `auth-storage.ts` + `api-client` Bearer contract intact).
3. **Server session endpoint** — new `POST /api/auth/keycloak/session` accepting KC access
   token; JWKS-verify against `${url}/realms/GS/protocol/openid-connect/certs` (jose
   `createRemoteJWKSet`, cached); extract claims; run existing default-deny → mint app JWT.
   Retire `/keycloak/callback` + `keycloak-token-exchange.ts` code path.
4. **Logout** — call `keycloak.logout({redirectUri})`; drop manual logout-URL building.
5. **Tests + docs** — update auth tests, `keycloak/realm-export.json` local client to
   public+PKCE for dev parity, `docs/deployment-guide.md` env table + flow diagram.

## Risks
- **R1 (security, HIGH):** keycloak-js puts token acquisition in the browser. Skipping JWKS
  on the session endpoint = trivial identity forgery → admin escalation via bootstrap/DB
  lookup. Strongly recommend enabling JWKS for phase 3. *User answered "no JWKS" before this
  threat-model shift was surfaced — needs explicit re-confirm.*
- **R2:** Local dev (`AUTH_DISABLED=true`) must still short-circuit keycloak-js (no init when
  config `enabled:false`) or local loses its synth-admin convenience.
- **R3:** Redirect URI style flips root vs `/auth/callback`; realm client must whitelist the
  new pattern or login loops. Coordinate with platform team before cutover.
- **R4:** Right-side chat panel + any iframe surfaces must tolerate keycloak-js check-sso
  (third-party-cookie / silent-SSO iframe can fail) — verify both chat surfaces.

## Open questions
1. Confirm R1: enable JWKS on the session endpoint (recommended) or accept the forgery risk?
2. Did platform register `playground-gds` redirect URIs as root (`/*`) or `/auth/callback`?
3. SAML IdP alias confirmed as exactly `saml`?
4. Keep server-minted app JWT (this plan) vs. drop it and verify KC token on every request?
