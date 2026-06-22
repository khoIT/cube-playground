# Keycloak / OIDC Authentication Inventory — cube-playground

**Date**: 2026-06-22  
**Work Context**: /Users/lap16299/Documents/code/cube-playground  
**Scope**: Exhaustive frontend + backend auth mapping (DEV & PROD)  

---

## EXECUTIVE SUMMARY

Cube-playground uses a **two-layer auth model**:
1. **Authentication** (OIDC/Keycloak) — identity broker, credential validation
2. **Authorization** (SQLite DB) — role + per-game/workspace grants, default-deny

Frontend initiates standard OIDC code-exchange flow with Keycloak. Server mints its own HS256 app JWT (not KC token) after successful code-exchange and DB authz check. All subsequent requests use `Authorization: Bearer <app-jwt>`.

**Current values** (LOCAL DEV):
- KC URL: `http://localhost:18080`
- KC Realm: `cube-playground`
- KC Client ID: `cube-playground-web`
- App JWT Secret: env var `JWT_SECRET` (HS256)

**PROD template** (from `.env.docker.local.example`):
- KC URL: `https://your-keycloak-host/` (placeholder; update needed)
- KC Realm: `GS`
- KC Client ID: `playground`
- Client Secret: env var `KEYCLOAK_CLIENT_SECRET` (confidential client)

---

## 1. FRONTEND KEYCLOAK INITIALIZATION

**File**: `src/auth/auth-context.tsx:92-105`

```typescript
function buildAuthorizeUrl(kc: KeycloakConfig): string {
  const params = new URLSearchParams({
    client_id: kc.clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: callbackRedirectUri(),
  });
  return `${kc.authUrl}?${params.toString()}`;
}
```

**Key init values passed from server** (`/api/auth/keycloak/config`):
- `authUrl` — `${KEYCLOAK_URL}/realms/${realm}/protocol/openid-connect/auth`
- `tokenUrl` — `${KEYCLOAK_URL}/realms/${realm}/protocol/openid-connect/token`
- `logoutUrl` — `${KEYCLOAK_URL}/realms/${realm}/protocol/openid-connect/logout`
- `clientId` — from `KEYCLOAK_CLIENT_ID` env var
- `realm` — from `KEYCLOAK_REALM` env var

**FE callback path**: `/auth/callback` (hardcoded in `auth-context.tsx:90`)  
**Redirect URI construction** (`auth-context.tsx:92-94`):
```typescript
function callbackRedirectUri(): string {
  const { origin } = window.location;
  return `${origin}${CALLBACK_PATH}`;  // e.g., http://localhost:3000/auth/callback
}
```

**PKCE**: Not configured (optional, standard code-exchange used).  
**Flow**: Authorization Code (standard OIDC, `response_type=code`).  
**Scopes requested**: `openid profile email` (line 101).

---

## 2. ENVIRONMENT VARIABLES — ALL LOCATIONS

### **LOCAL DEV** (`.env.example`)

```
AUTH_DISABLED=true                         # Default: synthes admin, no KC redirect
KEYCLOAK_URL=http://localhost:18080        # KC container on docker-compose
KEYCLOAK_REALM=cube-playground             # Local realm (see keycloak/realm-export.json)
KEYCLOAK_CLIENT_ID=cube-playground-web     # Public OIDC client
KEYCLOAK_CLIENT_SECRET=                    # Empty (public client)
JWT_SECRET=local-dev-app-jwt-secret-...    # HS256 app JWT secret (≥16 chars)
JWT_EXPIRES_MINUTES=720                    # App JWT lifespan (12 hours)
```

### **DOCKER LOCAL** (`.env.docker.local.example`)

```
AUTH_DISABLED=false                        # Enable real KC auth on stack
KEYCLOAK_URL=https://your-keycloak-host/  # Production KC URL (placeholder)
KEYCLOAK_REALM=GS                          # Production realm (placeholder)
KEYCLOAK_CLIENT_ID=playground              # Production client ID (placeholder)
KEYCLOAK_CLIENT_SECRET=                    # Confidential client secret (placeholder)
JWT_SECRET=local-dev-app-jwt-secret-...    # App JWT secret
JWT_EXPIRES_MINUTES=720
AUTH_BOOTSTRAP_ADMINS=you@vng.com.vn       # Bootstrap admin emails (comma-separated)
```

### **PRODUCTION** (Vault-synced `.env`, deployed by CI)

See `docs/deployment-guide.md` → "Environment variables — playground server" (lines 23–37).

**Required in prod**:
- `KEYCLOAK_URL` — prod Keycloak instance URL
- `KEYCLOAK_REALM` — prod realm name (e.g., `GS`)
- `KEYCLOAK_CLIENT_ID` — prod client ID (e.g., `playground-gds`)
- `KEYCLOAK_CLIENT_SECRET` — confidential client secret (vault-only)
- `JWT_SECRET` — app JWT signing secret
- `AUTH_BOOTSTRAP_ADMINS` — comma-separated initial admin emails (e.g., `admin@vng.com.vn,khoitn@vng.com.vn`)
- `CUBE_AUTH_INTERNAL_SECRET` — shared secret for `GET /internal/access/:key` (cube-dev integration)

---

## 3. BACKEND KEYCLOAK CONFIGURATION

### **Server Routes**

**File**: `server/src/routes/auth.ts`

| Route | Method | Purpose | Auth | Line |
|-------|--------|---------|------|------|
| `/api/auth/keycloak/config` | GET | Fetch KC URLs + client ID for FE | Public | 35 |
| `/api/auth/keycloak/callback` | POST | Exchange `code=` for app JWT | Public | 60 |
| `/api/auth/me` | GET | Echo current user + grants | Bearer JWT | 131 |
| `/api/auth/logout` | POST | Token revocation (server no-op) | Bearer JWT | 136 |

**Config route** (lines 35–58):
```typescript
app.get('/api/auth/keycloak/config', async () => {
  if (authDisabled()) {
    return { enabled: false };
  }
  const kcUrl = (process.env.KEYCLOAK_URL ?? '').replace(/\/+$/, '');
  const realm = process.env.KEYCLOAK_REALM ?? '';
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? '';
  if (!kcUrl || !realm || !clientId) {
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
```

**Callback route** (lines 60–129):
- Receives `{ code, redirectUri }` from FE
- Calls `exchangeKeycloakCode()` (see below)
- Default-deny: missing email or non-active DB grant → 403 ACCESS_PENDING
- On success: mints app JWT, returns `{ token, user }` with full grant set

---

### **Token Exchange Service**

**File**: `server/src/services/keycloak-token-exchange.ts`

**Function**: `exchangeKeycloakCode({ code, redirectUri })`

```typescript
async function exchangeKeycloakCode({ code, redirectUri }: ExchangeArgs): Promise<KeycloakClaims> {
  const kcUrl = envOrThrow('KEYCLOAK_URL').replace(/\/+$/, '');
  const realm = envOrThrow('KEYCLOAK_REALM');
  const clientId = envOrThrow('KEYCLOAK_CLIENT_ID');
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const tokenUrl = `${kcUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  
  // ... error handling ...
  
  const json = (await res.json()) as TokenResponse;
  // Prefer id_token (identity claims); fall back to access_token
  const identityToken = json.id_token ?? json.access_token;
  return decodeJwt(identityToken) as KeycloakClaims;
}
```

**KeycloakClaims interface** (lines 22–32):
```typescript
export interface KeycloakClaims {
  sub: string;
  preferred_username?: string;
  email?: string;
  realm_access?: { roles?: string[] };
  groups?: string[];  // Full path, e.g., ["/games/cfm_vn", "/games/jus_vn"]
}
```

**No JWKS verification** — KC access token is **trusted as freshly received** over the same TLS channel (left as follow-up per comment lines 14–17).

---

### **App JWT (Server-Minted, Not Keycloak)**

**File**: `server/src/services/app-jwt.ts`

Server mints its **own HS256 JWT** after successful KC code-exchange:

```typescript
export async function signAppJwt(claims: Omit<AppJwtClaims, 'iss' | 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('cube-playground')
    .setSubject(String(claims.sub))
    .setIssuedAt()
    .setExpirationTime(`${expirySeconds()}s`)
    .sign(secretBytes());
}
```

**AppJwtClaims**:
- `sub` — KC `sub` (stable user id)
- `username` — from KC preferred_username
- `email` — from KC email claim
- `role` — resolved from DB access store (NOT KC roles)

**Verification** (`verifyAppJwt(token)`):
- Algorithm: HS256
- Secret: `JWT_SECRET` env var (converted to bytes via TextEncoder)
- Issuer: `cube-playground`

---

## 4. AUTHENTICATION MIDDLEWARE

**File**: `server/src/middleware/authenticate.ts`

### **Dev Mode** (`AUTH_DISABLED=true`)

Synthesizes a local admin user automatically:
```typescript
function devUser(): AuthenticatedUser {
  return {
    id: devOwnerSub(),              // email string (khoitn@vng.com.vn or AUTH_BOOTSTRAP_ADMINS[0])
    username: devUsername(),        // email prefix
    email: devAdminEmail(),
    role: 'admin',
    gamesByWorkspace: { <all games per workspace> },
    workspaces: [],                 // Empty = role-based fallback (admin sees all)
    features: { <all features enabled> },
  };
}
```

**Dev identity source** (`server/src/auth/dev-identity.ts`):
```typescript
export const DEFAULT_DEV_ADMIN_EMAIL = 'khoitn@vng.com.vn';

export function devAdminEmail(): string {
  return parseBootstrapAdmins(process.env.AUTH_BOOTSTRAP_ADMINS)[0] ?? DEFAULT_DEV_ADMIN_EMAIL;
}
```

No Keycloak interaction; all requests instantly get the synthesized admin.

### **Real Auth Mode** (`AUTH_DISABLED=false` or unset)

1. Reads `Authorization: Bearer <app-jwt>` from request header (lines 108–113)
2. Calls `verifyAppJwt(token)` to validate signature + issuer
3. Resolves role + grants from **SQLite DB** (NOT from JWT; per-request)
4. If active grant exists: populates `request.user`
5. If no grant or pending/disabled status: leaves `request.user` undefined → protected routes return 401/403

**Cache**: DB access lookups cached via `ACCESS_CACHE_TTL_MS` (default 30s, lines 57–59 in `access-store.ts`).

---

## 5. ROLE-BASED ACCESS CONTROL (RBAC)

### **AppRole Enum**

```typescript
export type AppRole = 'viewer' | 'editor' | 'admin';
```

**Defined in**:
- `server/src/middleware/require-role.ts:18`
- `server/src/auth/access-store.ts:20`

### **Middleware Guards**

**File**: `server/src/middleware/require-role.ts`

```typescript
export function requireRole(...allowed: AppRole[]): preHandlerHookHandler {
  const set = new Set<AppRole>(allowed);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
    if (!set.has(request.user.role)) {
      return reply.status(403).send({
        error: 'Insufficient permissions',
        required: allowed,
        actual: request.user.role,
      });
    }
  };
}
```

**Usage**: `app.post('/api/segments', { preHandler: requireRole('editor', 'admin') }, ...)`

### **Workspace-Level allowedRoles**

**File**: `workspaces.config.json` (local dev) and `workspaces.prod.config.json` (prod)

Local dev example (line 18):
```json
{
  "id": "prod",
  "label": "Prod cube-dev (local mirror)",
  "cubeApiUrl": "http://localhost:16000",
  "authMode": "none",
  "gameModel": "prefix",
  "allowedRoles": ["editor", "admin"],  // Only editors + admins can access this workspace
  "gamePrefixMap": { ... }
}
```

**Behavior**: Server validates `request.user.role` against workspace's `allowedRoles` in `workspace-header.ts` (enforces before routing to Cube).

### **Default-Deny Model**

From `docs/deployment-guide.md` (lines 14–17):
```
- `user_access(email, role, status, kc_sub, …)` — role + `pending|active|disabled`.
- `user_workspace_access`, `user_game_access` — per-user grants.
```

**Status values**:
- `pending` — Authenticated by KC but no DB grant; 403 ACCESS_PENDING
- `active` — Grant exists; user is authorized
- `disabled` — Explicitly revoked; 403

No grant entry + `status != 'active'` = **default-deny** (403).

---

## 6. BOOTSTRAP & PRODUCTION CUTOVER

### **Bootstrap Admins** (`AUTH_BOOTSTRAP_ADMINS`)

**File**: `server/src/auth/bootstrap-admins.ts`

**Purpose**: Seed initial admin emails on every server boot (prevent lockout).

**Format**: Comma-separated, lowercase emails
```
AUTH_BOOTSTRAP_ADMINS=admin@vng.com.vn,khoitn@vng.com.vn
```

**Behavior** (lines 15–20 in `auth/bootstrap-admins.ts`):
```typescript
export function ensureBootstrapAdmins(): void {
  const admins = parseBootstrapAdmins(process.env.AUTH_BOOTSTRAP_ADMINS);
  const db = getDb();
  for (const email of admins) {
    upsertUserAccess(db, {
      email: normalizeEmail(email),
      role: 'admin',
      status: 'active',
    });
  }
}
```

**Prod requirement** (`docs/deployment-guide.md`, line 31):
> **Set before the first prod deploy** or no one can reach `/admin/access` (lockout).

---

## 7. LOCAL KEYCLOAK CONTAINER CONFIG

### **Realm Export**

**File**: `keycloak/realm-export.json`

**Realm**: `cube-playground`  
**Enabled**: true  
**Default role**: `viewer`

### **Roles**

Three realm-level roles (lines 15–21):
```json
"roles": {
  "realm": [
    { "name": "viewer", "description": "Read-only access..." },
    { "name": "editor", "description": "Can create + edit own artifacts..." },
    { "name": "admin", "description": "Full access..." }
  ]
}
```

**Note**: These are advisory in the **current app** — authorization is **DB-driven**, not KC roles (per deployment guide lines 10, 56). KC roles exist for backward compatibility and the `AUTHZ_GRANT_FALLBACK` migration flag.

### **Groups** (Game Scopes)

Game groups mirror the 7 supported titles (lines 31–45):
```json
"groups": [
  {
    "name": "games",
    "path": "/games",
    "subGroups": [
      { "name": "ptg", "path": "/games/ptg" },
      { "name": "ballistar", "path": "/games/ballistar" },
      { "name": "cfm_vn", "path": "/games/cfm_vn" },
      { "name": "cros", "path": "/games/cros" },
      { "name": "jus_vn", "path": "/games/jus_vn" },
      { "name": "muaw", "path": "/games/muaw" },
      { "name": "pubg", "path": "/games/pubg" }
    ]
  }
]
```

**Extracted by** `extractAllowedGames(groups)` in `keycloak-token-exchange.ts:109–117` (strips `/games/` prefix).

### **Test Users**

Three pre-seeded users (lines 47–81):
- `admin@cube-playground.local` / password `admin123` → realm role `admin`, all 7 games
- `editor@cube-playground.local` / password `editor123` → realm role `editor`, ballistar + cfm_vn
- `viewer@cube-playground.local` / password `viewer123` → realm role `viewer`, ballistar only

### **Client: `cube-playground-web`**

Lines 84–131:
- **Type**: Public OIDC client (no secret, `publicClient: true`)
- **Flow**: Authorization Code (`standardFlowEnabled: true`)
- **Redirect URIs**:
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/auth/callback/`
- **Web Origins**: `http://localhost:3000`
- **Scopes**: `openid profile email roles` (default), `groups` (optional)
- **Protocol Mappers**:
  - `groups` — includes full path groups in token
  - `realm-roles` — includes realm roles as `realm_access.roles`

**Mapper config** (lines 108–114):
```json
"config": {
  "full.path": "true",        // Full path: /games/cfm_vn (not just cfm_vn)
  "id.token.claim": "true",
  "access.token.claim": "true",
  "claim.name": "groups",
  "userinfo.token.claim": "true"
}
```

---

## 8. PRODUCTION vs. LOCAL

| Aspect | LOCAL DEV | PRODUCTION |
|--------|-----------|-----------|
| **Auth enabled** | `AUTH_DISABLED=true` (default) | `AUTH_DISABLED=false` |
| **Identity broker** | Local Keycloak container | Prod Keycloak (Microsoft/Entra OIDC) |
| **Keycloak realm** | `cube-playground` | `GS` (template) |
| **Client ID** | `cube-playground-web` | `playground-gds` (template) |
| **Client secret** | None (public) | Confidential (`KEYCLOAK_CLIENT_SECRET`) |
| **KC URL** | `http://localhost:18080` | `https://login.gio.vng.vn` (example) |
| **Auth synthesis** | Yes — dev admin synth, all games | No — default-deny, DB-driven |
| **Authorization** | Role-based fallback when disabled | DB-authoritative, per-user grants |
| **Cube workspace** | `local` (in-stack, game_id multi-tenant) | `local` (in-stack) + `prod` (external cube.gds.vng.vn) |
| **Cube token** | Minted by server w/ `userId=email` | Minted by server w/ `userId=email` |

---

## 9. FLOW DIAGRAM (OIDC Code Exchange)

```
┌─────────────────────────────────────────────────────────────────────┐
│ LOCAL DEV (AUTH_DISABLED=true)                                      │
├─────────────────────────────────────────────────────────────────────┤
│ (1) FE load  →  GET /api/auth/keycloak/config                       │
│                 ↓ { enabled: false }                                  │
│ (2) FE GET /api/auth/me  →  server synth admin (khoitn@vng.com.vn) │
│ (3) FE renders app immediately (no KC redirect)                      │
│                                                                       │
│ All requests: Bearer token = <locally-unused>                        │
│ Or: X-Owner: khoitn@vng.com.vn (legacy override)                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ REAL AUTH (AUTH_DISABLED=false)                                     │
├─────────────────────────────────────────────────────────────────────┤
│ (1) FE load  →  GET /api/auth/keycloak/config                       │
│                 ↓ { enabled: true, authUrl, tokenUrl, logoutUrl, clientId, realm }
│                                                                       │
│ (2) FE reads JWT from localStorage → GET /api/auth/me               │
│     ├─ If Bearer token valid → 200 with user                        │
│     └─ If no token → unauthenticated state                          │
│                                                                       │
│ (3) User clicks "Login"  →  FE redirects to:                        │
│     https://keycloak:18080/realms/cube-playground/protocol/openid-connect/auth
│       ?client_id=cube-playground-web
│       &response_type=code
│       &scope=openid profile email
│       &redirect_uri=http://localhost:3000/auth/callback              │
│                                                                       │
│ (4) User logs in at Keycloak  →  KC redirects to:                   │
│     http://localhost:3000/auth/callback?code=...&state=...           │
│                                                                       │
│ (5) FE extracts code  →  POST /api/auth/keycloak/callback           │
│     { code, redirectUri: "http://localhost:3000/auth/callback" }     │
│                                                                       │
│ (6) Server exchanges code  →  POST to KC:                           │
│     /realms/cube-playground/protocol/openid-connect/token            │
│     {                                                                 │
│       grant_type: "authorization_code",                              │
│       code: <...>,                                                    │
│       redirect_uri: "...",                                           │
│       client_id: "cube-playground-web",                              │
│       client_secret: <optional>                                      │
│     }                                                                 │
│                                                                       │
│ (7) Server receives id_token/access_token, decodes claims:          │
│     { sub, email, preferred_username, groups, realm_access.roles }   │
│                                                                       │
│ (8) **Default-deny check**: lookup email in DB user_access          │
│     ├─ If status != 'active' → 403 ACCESS_PENDING                   │
│     ├─ If status == 'active' → resolve role + grants from DB        │
│     └─ Generate app JWT (HS256, JWT_SECRET)                          │
│                                                                       │
│ (9) Return to FE: { token: <app-jwt>, user: {...grants...} }       │
│                                                                       │
│ (10) FE stores app JWT in localStorage, redirects to /#/             │
│                                                                       │
│ (11) All subsequent requests:  Authorization: Bearer <app-jwt>      │
│      Server verifies JWT, checks DB for active status + grants      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10. PRODUCTION TEMPLATE (MIGRATION TO NEW KC)

Based on `.env.docker.local.example` (lines 100–103), **expected prod template**:

```bash
KEYCLOAK_URL=https://login.gio.vng.vn/
KEYCLOAK_REALM=GS
KEYCLOAK_CLIENT_ID=playground-gds
KEYCLOAK_CLIENT_SECRET=<vault-secret>
JWT_SECRET=<32+ random chars>
AUTH_BOOTSTRAP_ADMINS=admin@vng.com.vn,khoitn@vng.com.vn
CUBE_AUTH_INTERNAL_SECRET=<shared with cube-dev>
INTERNAL_SECRET=<shared with chat-service>
```

**New Keycloak realm (GS) must configure**:
1. OIDC client `playground-gds` (confidential, client secret required)
2. Redirect URI: `https://playground.gds.vng.vn/auth/callback`
3. Web origin: `https://playground.gds.vng.vn`
4. Microsoft/Entra identity provider (IdP) broker
5. Scopes: `openid profile email` (minimal)
6. **No role/group mappers** in KC (authorization is app-side now per lines 56 in deployment guide)

---

## UNRESOLVED QUESTIONS

1. **New KC realm (GS) configuration**: Where is the existing `GS` realm YAML/config? Has Microsoft/Entra IdP been registered yet?
2. **Client secret rotation**: How are `KEYCLOAK_CLIENT_SECRET` and `JWT_SECRET` rotated in prod without locking users out?
3. **JWKS verification**: Why is KC token verification deferred (line 14–17 in keycloak-token-exchange.ts)? Should prod implement JWKS verification against `https://login.gio.vng.vn/realms/GS/protocol/openid-connect/certs`?
4. **Entra-specific claims**: Are there any multi-tenant Entra orgs or service-principal flows that should be blocked at the app layer?
5. **Keycloak Admin API**: Are admins expected to manage KC realm config, or only the SQLite `user_access` table?

---

## KEY FILES INVENTORY

| File | Purpose | Lines | Type |
|------|---------|-------|------|
| `server/src/routes/auth.ts` | OIDC callback, config, logout | 1–143 | Routes |
| `server/src/services/keycloak-token-exchange.ts` | Code→token exchange, claims extraction | 1–118 | Service |
| `server/src/services/app-jwt.ts` | App JWT sign/verify (HS256) | 1–63 | Service |
| `server/src/middleware/authenticate.ts` | JWT verification, grant resolution | 1–182 | Middleware |
| `server/src/middleware/require-role.ts` | Role-based access guard | 1–39 | Middleware |
| `server/src/auth/access-store.ts` | DB access cache, email→role lookup | 1–200+ | Auth |
| `server/src/auth/dev-identity.ts` | Synthesized local admin | 1–31 | Auth |
| `server/src/auth/feature-keys.ts` | Feature flag definitions | — | Auth |
| `src/auth/auth-context.tsx` | FE OIDC flow, token storage | 1–265 | Frontend |
| `src/auth/auth-storage.ts` | localStorage JWT persistence | — | Frontend |
| `.env.example` | Local dev env template | 92–137 | Config |
| `.env.docker.local.example` | Docker stack env template | 97–104 | Config |
| `keycloak/realm-export.json` | Local KC realm, roles, groups, client | 1–134 | Config |
| `workspaces.config.json` | Workspace registry (local dev) | 1–27 | Config |
| `workspaces.prod.config.json` | Workspace registry (prod) | 1–27 | Config |
| `docs/deployment-guide.md` | Prod KC + authz setup guide | Lines 1–200+ | Docs |
| `docs/journals/2026-05-30-...md` | Authz migration journal | 1–83 | Journal |

