/**
 * Top-of-tree gate: renders the app only when authenticated (real Keycloak
 * flow) or AUTH_DISABLED (dev). While bootstrapping, shows a thin loader;
 * when SSO is on but the user has no token, shows a Login screen that
 * redirects to Keycloak.
 *
 * Sits ABOVE HashRouter so the OAuth callback path (/auth/callback) can be
 * handled by AuthProvider before React Router gets involved.
 */

import { type ReactNode } from 'react';

import { useAuth } from './auth-context';

interface AuthGateProps {
  children: ReactNode;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  background: 'var(--bg-app, #fafafa)',
  color: 'var(--text-primary, #111)',
  fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)',
};

export function AuthGate({ children }: AuthGateProps) {
  const { state, loginWithKeycloak } = useAuth();

  if (state.status === 'loading') {
    return (
      <div style={overlayStyle} aria-busy="true" aria-label="Loading session">
        <div style={{ fontSize: 14, opacity: 0.7 }}>Loading session…</div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div style={overlayStyle} role="alert">
        <div style={{ fontSize: 16, fontWeight: 600 }}>Auth bootstrap failed</div>
        <pre style={{ fontSize: 12, opacity: 0.75, maxWidth: 480, whiteSpace: 'pre-wrap' }}>
          {state.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 14px',
            border: '1px solid var(--border-card, #ccc)',
            borderRadius: 'var(--radius-md, 6px)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (state.status === 'unauthenticated') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Cube Playground</div>
        <div style={{ fontSize: 14, opacity: 0.7, maxWidth: 360, textAlign: 'center' }}>
          Sign in with your Keycloak account to continue.
        </div>
        <button
          type="button"
          onClick={loginWithKeycloak}
          style={{
            padding: '10px 18px',
            border: '1px solid var(--brand, #ff6b35)',
            background: 'var(--brand, #ff6b35)',
            color: '#fff',
            borderRadius: 'var(--radius-md, 6px)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign in with Keycloak
        </button>
      </div>
    );
  }

  // `disabled` or `authenticated` — render the app.
  return <>{children}</>;
}
