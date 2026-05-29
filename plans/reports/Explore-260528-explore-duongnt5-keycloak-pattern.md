# Scout Report: duongnt5 Keycloak SSO + RBAC Pattern

**Objective:** Identify the PATTERN (not code) for Keycloak SSO + RBAC we should mirror into cube-playground (Fastify/Node + React/Vite).

---

## 1. Keycloak Docker Setup

**Location:** `/docker-compose.yml` (lines 77–94)

- **Image:** `quay.io/keycloak/keycloak:26.0`, runs in start-dev mode with `--import-realm`
- **Import source:** `./keycloak/realm-export.json` (mounted read-only)
- **Port:** Configurable via `KEYCLOAK_PORT` (default 14002), healthcheck on `/health/ready`
- **Admin creds:** `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` (env-driven)

**Realm export shape** (`realm-export.json`):
- Realm name: `"s2s"` (custom, not default "master")
- **Roles (realm-level):** `superadmin`, `admin`, `editor`, `viewer` (lines 11–17)
- **Client:** `"s2s-dashboard"`, public client, OIDC protocol, standard flow enabled
  - Redirect URIs: `http://localhost:14000/*` (frontend)
  - Default scopes: `openid`, `profile`, `email`, `roles`
- **Test users:** 3 hardcoded (admin/editor/viewer) with realm roles (lines 36–64)

---

## 2. Backend Auth Flow

### `/api/auth/keycloak/config` (GET)
**File:** `backend/app/routers/auth.py:57–66`
Returns KC config IF enabled:
```
{
  enabled: bool,
  auth_url: "https://kc.../realms/s2s/protocol/openid-connect/auth",
  client_id: "s2s-dashboard",
  logout_url: "https://kc.../realms/s2s/protocol/openid-connect/logout"
}
```

### `/api/auth/keycloak/callback` (POST)
**File:** `backend/app/routers/auth.py:77–146`
1. **Code exchange:** POST to `settings.keycloak_token_url` with `grant_type=authorization_code`, code, secret, redirect_uri
2. **Token decode:** use `python-jose` lib; `jose_jwt.get_unverified_claims(access_token)` (trusts fresh KC token, no JWKS fetch)
3. **User extraction:** reads `preferred_username` and `realm_access.roles` from token
4. **Role resolution:** picks highest privilege from realm roles via `_resolve_kc_role()` (superadmin > admin > editor > viewer)
5. **Auto-provision:** user created if missing, role auto-set from KC; existing user role NOT overwritten (admin may have set manually)
6. **App JWT mint:** `create_access_token(user.id, username, role)` → returns local Bearer token (not KC's token)

### `/api/auth/me` (GET)
**File:** `backend/app/routers/auth.py:47–51`
Dependency: `Depends(get_current_user)` → returns User model (id, username, role, dept, created_at).

### JWKS Verification
**Library:** `python-jose` (line 109, import `jwt as jose_jwt`)
**Pattern:** KC token decoded but NOT verified against JWKS (trusts freshly-issued token from code exchange). No JWKS endpoint hit.

### Middleware/Decorator for Auth on Every Request
**File:** `backend/app/auth.py:37–63` — `async def get_current_user()`
- Uses FastAPI `HTTPBearer()` security scheme (line 15)
- Dependency injection: `Depends(security)` extracts Bearer token from `Authorization` header
- Decodes local JWT (NOT KC token) with `jwt.decode(token, settings.jwt_secret, ...)`
- Validates user exists in DB, returns `User` object
- Applied to routes via `Depends(get_current_user)`

---

## 3. RBAC Enforcement

**Role gating decorator:** `backend/app/auth.py:66–77` — `require_role(*roles: str)`
```python
def require_role(*roles: str):
  async def dependency(current_user: Depends(get_current_user)) -> User:
    if current_user.role.value not in roles:
      raise HTTPException(status_code=403, detail="Insufficient permissions")
    return current_user
  return dependency
```

**Usage:** `@router.post("...", dependencies=[Depends(require_role("admin", "superadmin"))])`

**Role extraction from token:** In `/keycloak/callback`, reads `realm_access.roles` from KC access token (line 119).

---

## 4. Frontend Auth Flow

### `AuthContext` shape
**File:** `frontend/src/auth.tsx:5–21`
- `user: User | null` (id, username, role, dept, created_at)
- `loading: bool`
- `keycloak: KeycloakConfig | null` (enabled, auth_url, client_id, logout_url)
- Methods: `login()`, `loginWithKeycloak()`, `handleKeycloakCallback()`, `logout()`, `refreshUser()`

**State initialization:** Checks `localStorage.getItem('token')` on mount (line 40); fetches `/auth/me` to hydrate user.

### `/auth/callback` page
**File:** `frontend/src/pages/AuthCallback.tsx`
1. Extract `code` from URL query params
2. Call `handleKeycloakCallback(code, redirectUri)` → POST to `/api/auth/keycloak/callback`
3. On success: store app JWT in `localStorage`, navigate to home
4. On error: display error UI + link back to login

### `ProtectedRoute` component
**File:** `frontend/src/App.tsx:10–25`
```tsx
function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" />
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" />
  }
  return children
}
```

### API client + Bearer token attachment
**File:** `frontend/src/api.ts`
- Axios interceptor (request): extracts `token` from `localStorage`, attaches as `Authorization: Bearer {token}`
- Interceptor (response): catches 401 → clears token + redirects to `/login`

---

## 5. Realm Export Specifics

**Realm name:** `"s2s"`

**Roles (realm-level):**
1. `superadmin` — Full access
2. `admin` — Can approve/reject configs
3. `editor` — Can submit configs
4. `viewer` — Can view dashboard and games (default for new KC users)

**Test users:**
- `admin` / `admin123` → superadmin
- `editor1` / `editor123` → editor
- `viewer1` / `viewer123` → viewer

**Group naming:** None in export; groups feature not used in this setup.

---

## Key Patterns to Mirror

1. **Public OIDC client** (no secret stored in frontend); secret kept server-side only
2. **Code-exchange on backend** (frontend never touches KC token directly)
3. **App JWT minting** (frontend stores local token, not KC's; KC token discarded after code exchange)
4. **Auto-provisioning** (user created in app DB on first KC login; role auto-set from KC realm roles)
5. **Role priority resolution** (superadmin > admin > editor > viewer)
6. **No JWKS fetch** (KC token trusted fresh-from-code-exchange; app JWT verified with HS256 secret)
7. **Dependency injection pattern** (FastAPI `Depends(get_current_user)` + `require_role()`)

---

## Env Vars Used

Backend expects:
- `KEYCLOAK_URL` (public URL for browser redirects)
- `KEYCLOAK_INTERNAL_URL` (optional; backend-to-backend token exchange, if behind proxy)
- `KEYCLOAK_REALM` (e.g., "s2s")
- `KEYCLOAK_CLIENT_ID` (e.g., "s2s-dashboard")
- `KEYCLOAK_CLIENT_SECRET` (only if not public client)
- `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRE_MINUTES` (for local token)

