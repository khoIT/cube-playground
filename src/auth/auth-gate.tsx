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

/**
 * VNGGAMES wordmark + product label, matching the VNG SSO brand lockup:
 * "VNG" in brand orange, "GAMES" in primary ink, a thin vertical divider,
 * then the product name in secondary ink.
 */
function VngGamesWordmark({ product }: { product: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)',
      }}
    >
      <span
        style={{
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        <span style={{ color: 'var(--brand)' }}>VNG</span>
        <span style={{ color: 'var(--text-primary)' }}>GAMES</span>
      </span>
      <span
        style={{
          width: 1,
          height: 24,
          background: 'var(--border-strong, var(--border-card))',
        }}
      />
      <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-secondary)' }}>
        {product}
      </span>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
    </svg>
  );
}

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
        <div
          style={{
            width: '100%',
            maxWidth: 460,
            padding: '40px 40px 44px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg, 10px)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
          }}
        >
          <VngGamesWordmark product="Cube Playground" />
          <div
            style={{
              fontSize: 15,
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
              textAlign: 'center',
              maxWidth: 320,
            }}
          >
            Sign in to access the Cube Playground analytics workspace.
          </div>
          <button
            type="button"
            onClick={loginWithKeycloak}
            style={{
              width: '100%',
              marginTop: 4,
              padding: '14px 18px',
              border: '1px solid var(--brand)',
              background: 'var(--brand)',
              color: 'var(--text-on-brand)',
              borderRadius: 'var(--radius-md, 8px)',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <ShieldIcon />
            Sign in with Keycloak
          </button>
        </div>
      </div>
    );
  }

  // `disabled` or `authenticated` — render the app.
  return <>{children}</>;
}
