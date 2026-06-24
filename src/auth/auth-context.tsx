/**
 * Auth bootstrap + session state for the whole app.
 *
 * Lives at the top of the React tree (above HashRouter) so it can:
 *
 *   1. Run keycloak-js. /api/auth/keycloak/config hands the FE the raw realm
 *      coords ({ url, realm, clientId, idpHint }). keycloak-js then owns the
 *      OIDC + PKCE handshake: `init({ pkceMethod: 'S256' })` parses any login
 *      redirect already in the URL, and `login({ idpHint })` routes the user
 *      straight to the brokered SAML IdP via a full-page redirect. The OAuth
 *      response lands back on the site root (responseMode 'query'); keycloak-js
 *      parses + strips the `?code=` params before our HashRouter renders. We do
 *      NOT use silent check-sso: the realm forbids iframe embedding, so the
 *      probe would hang (see initKeycloakOnce).
 *
 *   2. Trade the KC id_token for our app JWT. Once keycloak-js is authenticated,
 *      we POST `keycloak.idToken` to /api/auth/keycloak/session; the server
 *      JWKS-verifies it, runs the default-deny DB check, and returns the app
 *      JWT we persist + send as `Authorization: Bearer` on every request.
 *
 *   3. Decide whether SSO is on. /api/auth/keycloak/config returns
 *      `{ enabled: false }` when AUTH_DISABLED=true (or KC env vars are
 *      missing). In that mode we skip keycloak-js entirely, call /api/auth/me,
 *      get the synthesized dev user, and never redirect.
 *
 *   4. Gate the app until ready. While loading or when SSO is on but the
 *      user has no token, children are not rendered — we show a Login button.
 */

import Keycloak from 'keycloak-js';
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { clearAppToken, readAppToken, writeAppToken } from './auth-storage';

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  role: 'viewer' | 'editor' | 'admin';
  /** Game grants scoped per workspace id. The picker narrows to the ACTIVE
   *  workspace's list (fail-closed: empty/absent → no games for real-auth users).
   *  Absent on older payloads → treated as `{}`. */
  gamesByWorkspace?: Record<string, string[]>;
  /** Workspace ids granted to the user. Empty/absent → role-based fallback.
   *  Filtering happens server-side in /api/workspaces; carried here for parity. */
  workspaces?: string[];
  /** Resolved feature map (key → enabled), DB-authoritative. Optional for
   *  back-compat with older /me payloads; absent → treat as no overrides. */
  features?: Record<string, boolean>;
}

/**
 * Flattened, de-duped union of a user's per-workspace game grants. For surfaces
 * that are inherently cross-workspace (e.g. cross-game JOIN targets) and aren't
 * scoped to one active workspace — those still narrow per-workspace.
 */
export function allGamesUnion(
  user: Pick<AuthUser, 'gamesByWorkspace'> | null | undefined,
): string[] {
  return [...new Set(Object.values(user?.gamesByWorkspace ?? {}).flat())];
}

interface KeycloakConfig {
  enabled: true;
  /** Raw realm base, e.g. https://login.gio.vng.vn — keycloak-js builds the rest. */
  url: string;
  realm: string;
  clientId: string;
  /** Optional brokered-IdP alias (e.g. 'saml'); routes login past the picker. */
  idpHint?: string;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'disabled'; user: AuthUser }
  | { status: 'authenticated'; user: AuthUser; keycloak: KeycloakConfig }
  | { status: 'unauthenticated'; keycloak: KeycloakConfig }
  // Authenticated with the IdP but not authorized in the app DB (default-deny).
  | { status: 'pending'; keycloak: KeycloakConfig }
  | { status: 'error'; message: string };

interface AuthContextValue {
  state: AuthState;
  loginWithKeycloak: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// keycloak-js holds the live SSO session. It is a singleton: init() may run only
// ONCE per instance, so we memoize both the instance and its init promise across
// re-bootstraps (and React StrictMode's double-invoked effects).
let kcInstance: Keycloak | null = null;
let kcInitPromise: Promise<boolean> | null = null;

function getKeycloak(config: KeycloakConfig): Keycloak {
  if (!kcInstance) {
    kcInstance = new Keycloak({
      url: config.url,
      realm: config.realm,
      clientId: config.clientId,
    });
  }
  return kcInstance;
}

function initKeycloakOnce(kc: Keycloak): Promise<boolean> {
  if (!kcInitPromise) {
    // No `onLoad: 'check-sso'`: the corporate realm forbids being framed
    // (X-Frame-Options: SAMEORIGIN, CSP frame-ancestors 'self'), so the silent
    // check-sso iframe can never redirect back and `init()` would hang forever.
    // Without onLoad, init() still parses a login redirect already present in
    // the URL (the `?code=` from a just-completed full-page login) and resolves
    // `false` immediately for a fresh visit — landing on the login screen. The
    // persisted app JWT (bootstrap path 2) already restores sessions on reload;
    // we only lose cross-tab silent re-login, which the framed probe blocked
    // here anyway.
    kcInitPromise = kc.init({
      pkceMethod: 'S256',
      // Keep OAuth params in the query string, not the hash — HashRouter owns
      // the hash and would otherwise collide with the auth response.
      responseMode: 'query',
      // We rely on the app JWT for session lifetime, not KC's login iframe.
      checkLoginIframe: false,
    });
  }
  return kcInitPromise;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface SessionResponse {
  token: string;
  user: AuthUser;
}

interface MeResponse {
  user: AuthUser;
}

type ConfigResponse = { enabled: false } | KeycloakConfig;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  // Trade a realm-signed id_token for our app JWT. 403 = authenticated with the
  // IdP but no active app grant (default-deny → pending approval queue).
  const establishSession = useCallback(async (idToken: string, config: KeycloakConfig) => {
    const res = await fetch('/api/auth/keycloak/session', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (res.status === 403) {
      setState({ status: 'pending', keycloak: config });
      return;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`/api/auth/keycloak/session ${res.status} ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as SessionResponse;
    writeAppToken(data.token);
    setState({ status: 'authenticated', user: data.user, keycloak: config });
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const config = await fetchJson<ConfigResponse>('/api/auth/keycloak/config');

      // (1) AUTH_DISABLED: /me synthesizes a dev/admin user; skip keycloak-js.
      if (!config.enabled) {
        const me = await fetchJson<MeResponse>('/api/auth/me');
        setState({ status: 'disabled', user: me.user });
        return;
      }

      // (2) A still-valid app JWT survives reloads without a KC round-trip.
      const existing = readAppToken();
      if (existing) {
        try {
          const me = await fetchJson<MeResponse>('/api/auth/me', {
            headers: { Authorization: `Bearer ${existing}` },
          });
          setState({ status: 'authenticated', user: me.user, keycloak: config });
          return;
        } catch {
          clearAppToken();
        }
      }

      // (3) Run keycloak-js. check-sso silently authenticates if a realm session
      // exists, and parses + strips any ?code= left by a just-completed login.
      const kc = getKeycloak(config);
      const authenticated = await initKeycloakOnce(kc);
      if (authenticated && kc.idToken) {
        // Keep the KC tokens fresh while the tab is open so a later app-JWT
        // expiry can re-establish silently (see onForceLogout below).
        kc.onTokenExpired = () => {
          void kc.updateToken(30);
        };
        await establishSession(kc.idToken, config);
        return;
      }
      setState({ status: 'unauthenticated', keycloak: config });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [establishSession]);

  useEffect(() => {
    void bootstrap();
    // Listen for 401-triggered force-logout from the api-client. When the app
    // JWT expires we force-refresh the KC tokens (if the realm session is still
    // alive) so re-bootstrap can mint a new app JWT without user interaction.
    const onForceLogout = () => {
      clearAppToken();
      if (kcInstance?.authenticated) {
        void kcInstance
          .updateToken(-1)
          .catch(() => {})
          .finally(() => {
            void bootstrap();
          });
      } else {
        void bootstrap();
      }
    };
    window.addEventListener('gds-cube:auth-force-logout', onForceLogout);
    return () => window.removeEventListener('gds-cube:auth-force-logout', onForceLogout);
  }, [bootstrap]);

  const loginWithKeycloak = useCallback(() => {
    if (state.status !== 'unauthenticated' && state.status !== 'authenticated') return;
    const kc = getKeycloak(state.keycloak);
    // idpHint routes straight to the brokered SAML IdP; redirect lands on the
    // site root where keycloak-js parses the OAuth response on next init.
    void kc.login({
      redirectUri: `${window.location.origin}/`,
      idpHint: state.keycloak.idpHint,
      scope: 'openid profile email',
    });
  }, [state]);

  const logout = useCallback(async () => {
    clearAppToken();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* server logout is a stateless no-op anyway */
    }
    // For SSO sessions, also end the realm session so the next login isn't
    // silently re-bound to the same user via the KC SSO cookie. Pending users
    // log out too so they can retry with a different corporate account.
    //
    // The adapter may not exist yet: a page that bootstrapped from a still-valid
    // app JWT never created/inited keycloak-js (bootstrap path 2 returns early).
    // If we only cleared the local token, the next check-sso would silently
    // re-authenticate via the realm cookie and the user would never log out.
    // So create + init the adapter on demand to reach the realm end-session
    // endpoint.
    if (state.status === 'authenticated' || state.status === 'pending') {
      const kc = getKeycloak(state.keycloak);
      try {
        await initKeycloakOnce(kc);
      } catch {
        /* init hiccup — kc.logout still builds the end-session redirect */
      }
      await kc.logout({ redirectUri: window.location.origin });
      return;
    }
    // AUTH_DISABLED (local dev): no realm session exists — re-bootstrap restores
    // the synthesized dev user so the app stays usable.
    await bootstrap();
  }, [state, bootstrap]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, loginWithKeycloak, logout }),
    [state, loginWithKeycloak, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Outside the provider — return a stable "loading" shape so consumers
    // can render without crashing (used by isolated test trees).
    return {
      state: { status: 'loading' },
      loginWithKeycloak: () => {},
      logout: async () => {},
    };
  }
  return ctx;
}

/** Narrow helper used by routes and the Cube SDK glue. */
export function useAuthUser(): AuthUser | null {
  const { state } = useAuth();
  if (state.status === 'authenticated' || state.status === 'disabled') return state.user;
  return null;
}
