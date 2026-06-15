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
  background: 'var(--bg-app)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)',
};

export function AuthGate({ children }: AuthGateProps) {
  const { state, loginWithKeycloak, logout } = useAuth();

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
            border: '1px solid var(--border-card)',
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

  if (state.status === 'pending') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Access pending</div>
        <div style={{ fontSize: 14, opacity: 0.7, maxWidth: 380, textAlign: 'center' }}>
          You&apos;re signed in, but your account hasn&apos;t been granted access yet. An
          administrator has been notified — please check back once your request is approved.
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          style={{
            padding: '10px 18px',
            border: '1px solid var(--border-card)',
            background: 'transparent',
            color: 'var(--text-primary)',
            borderRadius: 'var(--radius-md, 6px)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign in with a different account
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
            border: '1px solid var(--brand)',
            background: 'var(--brand)',
            color: 'var(--text-on-brand)',
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
