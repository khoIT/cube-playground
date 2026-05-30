/**
 * Auth bootstrap + session state for the whole app.
 *
 * Lives at the top of the React tree (above HashRouter) so it can:
 *
 *   1. Intercept the OAuth callback. Keycloak redirects to
 *      http://localhost:3000/auth/callback?code=… ; vite's SPA fallback
 *      serves index.html for that path. Because the rest of the app uses
 *      HashRouter, the React Router tree never matches /auth/callback as
 *      a route. So we handle it here, BEFORE any router renders: extract
 *      the code, POST it to the server, persist the app JWT, then strip
 *      the search + bounce back to `#/`.
 *
 *   2. Decide whether SSO is on. /api/auth/keycloak/config returns
 *      `{ enabled: false }` when AUTH_DISABLED=true (or KC env vars are
 *      missing). In that mode we silently call /api/auth/me, get the
 *      synthesized dev user, and never redirect.
 *
 *   3. Gate the app until ready. While loading or when SSO is on but the
 *      user has no token, children are not rendered — we show a Login
 *      button (or auto-redirect, configurable).
 */

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
  allowedGames: string[];
  /** Resolved feature map (key → enabled), DB-authoritative. Optional for
   *  back-compat with older /me payloads; absent → treat as no overrides. */
  features?: Record<string, boolean>;
}

interface KeycloakConfig {
  enabled: true;
  authUrl: string;
  tokenUrl: string;
  logoutUrl: string;
  clientId: string;
  realm: string;
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

const CALLBACK_PATH = '/auth/callback';

function callbackRedirectUri(): string {
  const { origin } = window.location;
  return `${origin}${CALLBACK_PATH}`;
}

function buildAuthorizeUrl(kc: KeycloakConfig): string {
  const params = new URLSearchParams({
    client_id: kc.clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: callbackRedirectUri(),
  });
  return `${kc.authUrl}?${params.toString()}`;
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

interface CallbackResponse {
  token: string;
  user: AuthUser;
}

interface MeResponse {
  user: AuthUser;
}

type ConfigResponse = { enabled: false } | KeycloakConfig;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const bootstrap = useCallback(async () => {
    try {
      const config = await fetchJson<ConfigResponse>('/api/auth/keycloak/config');

      // (1) Handle the OAuth callback BEFORE consulting the token.
      // The redirect URL looks like .../auth/callback?code=…&state=…
      const url = new URL(window.location.href);
      const isCallback = url.pathname === CALLBACK_PATH && url.searchParams.has('code');
      if (config.enabled && isCallback) {
        const code = url.searchParams.get('code')!;
        const res = await fetch('/api/auth/keycloak/callback', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirectUri: callbackRedirectUri() }),
        });
        // Strip ?code= regardless of outcome so a refresh doesn't replay it.
        window.history.replaceState(null, '', '/');
        window.location.hash = '#/';
        // Default-deny: authenticated with the IdP but no active app grant.
        if (res.status === 403) {
          setState({ status: 'pending', keycloak: config });
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`/api/auth/keycloak/callback ${res.status} ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as CallbackResponse;
        writeAppToken(data.token);
        setState({ status: 'authenticated', user: data.user, keycloak: config });
        return;
      }

      // (2) AUTH_DISABLED: /me synthesizes a dev/admin user; render directly.
      if (!config.enabled) {
        const me = await fetchJson<MeResponse>('/api/auth/me');
        setState({ status: 'disabled', user: me.user });
        return;
      }

      // (3) SSO mode: try the existing token; on 401 stay unauthenticated.
      const token = readAppToken();
      if (token) {
        try {
          const me = await fetchJson<MeResponse>('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          setState({ status: 'authenticated', user: me.user, keycloak: config });
          return;
        } catch {
          clearAppToken();
        }
      }
      setState({ status: 'unauthenticated', keycloak: config });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void bootstrap();
    // Listen for 401-triggered force-logout from the api-client.
    const onForceLogout = () => {
      clearAppToken();
      void bootstrap();
    };
    window.addEventListener('gds-cube:auth-force-logout', onForceLogout);
    return () => window.removeEventListener('gds-cube:auth-force-logout', onForceLogout);
  }, [bootstrap]);

  const loginWithKeycloak = useCallback(() => {
    if (state.status === 'unauthenticated' || state.status === 'authenticated') {
      window.location.assign(buildAuthorizeUrl(state.keycloak));
    }
  }, [state]);

  const logout = useCallback(async () => {
    clearAppToken();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* server logout is a no-op anyway */
    }
    // For SSO sessions, also end the KC session so the next login isn't
    // silently re-bound to the same user via the KC SSO cookie. Pending users
    // log out too so they can retry with a different corporate account.
    if (state.status === 'authenticated' || state.status === 'pending') {
      const params = new URLSearchParams({
        client_id: state.keycloak.clientId,
        post_logout_redirect_uri: window.location.origin,
      });
      window.location.assign(`${state.keycloak.logoutUrl}?${params.toString()}`);
      return;
    }
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
