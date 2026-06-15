/**
 * Chat thread status banners — disconnect, rate-limited, error, and compact-warning chip.
 * Pure presentational components; receive callbacks from the page.
 */
import React from 'react';
import { T } from '../../../shell/theme';

// ---------------------------------------------------------------------------
// Disconnect banner
// ---------------------------------------------------------------------------

interface DisconnectBannerProps {
  onReconnect: () => void;
}

export function DisconnectBanner({ onReconnect }: DisconnectBannerProps) {
  return (
    <div
      data-testid="disconnect-banner"
      style={{
        padding: '8px 16px',
        background: 'var(--shell-warning-soft)',
        borderBottom: `1px solid var(--shell-warning)`,
        fontFamily: T.fSans,
        fontSize: 13,
        color: 'var(--shell-text-emphasis)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>Connection lost — click to refresh</span>
      <button
        type="button"
        data-testid="disconnect-reconnect-btn"
        onClick={onReconnect}
        style={{
          background: 'none',
          border: `1px solid var(--shell-warning)`,
          borderRadius: 4,
          padding: '2px 10px',
          cursor: 'pointer',
          fontFamily: T.fSans,
          fontSize: 13,
          color: 'var(--shell-text-emphasis)',
        }}
      >
        Refresh
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate-limited banner
// ---------------------------------------------------------------------------

interface RateLimitedBannerProps {
  retryAfterMs: number;
}

export function RateLimitedBanner({ retryAfterMs }: RateLimitedBannerProps) {
  const secs = Math.ceil(retryAfterMs / 1000);
  return (
    <div
      data-testid="rate-limited-banner"
      style={{
        padding: '8px 16px',
        background: 'var(--shell-warning-soft)',
        borderBottom: `1px solid var(--shell-warning)`,
        fontFamily: T.fSans,
        fontSize: 13,
        color: 'var(--shell-text-emphasis)',
      }}
    >
      Slow down — try again in {secs} second{secs !== 1 ? 's' : ''}.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

interface ErrorBannerProps {
  onDismiss: () => void;
  /** Server-classified headline (e.g. "AI service refused the request (403)"). */
  title?: string | null;
  /** Actionable "where to fix" guidance. */
  hint?: string | null;
  /** Raw underlying error text — shown small, below the hint, for debugging. */
  detail?: string | null;
}

export function ErrorBanner({ onDismiss, title, hint, detail }: ErrorBannerProps) {
  // Fall back to the generic copy when the server didn't classify the error.
  const headline = title || 'Something went wrong. Please try again.';
  return (
    <div
      data-testid="error-banner"
      style={{
        padding: '10px 16px',
        background: 'var(--shell-danger-soft)',
        borderTop: `1px solid var(--shell-danger)`,
        fontFamily: T.fSans,
        fontSize: 13,
        color: 'var(--shell-danger-strong)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{headline}</span>
        {hint && (
          <span style={{ color: 'var(--shell-text-secondary)' }}>
            <strong style={{ fontWeight: 600 }}>Where to fix:</strong> {hint}
          </span>
        )}
        {detail && (
          <span
            style={{
              color: 'var(--shell-text-subtle)',
              fontSize: 12,
              fontFamily: T.fMono ?? 'monospace',
              wordBreak: 'break-word',
            }}
          >
            {detail}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--shell-danger-strong)', fontFamily: T.fSans, fontSize: 13, flexShrink: 0 }}
      >
        Dismiss
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact-warning chip
// ---------------------------------------------------------------------------

export function CompactWarningChip() {
  return (
    <div
      data-testid="compact-warning-chip"
      style={{
        margin: '4px 16px',
        padding: '4px 10px',
        background: 'var(--shell-info-soft)',
        border: `1px solid var(--shell-info-alt)`,
        borderRadius: 12,
        fontFamily: T.fSans,
        fontSize: 12,
        color: 'var(--shell-info)',
        alignSelf: 'center',
      }}
    >
      Earlier turns summarised to save context
    </div>
  );
}
