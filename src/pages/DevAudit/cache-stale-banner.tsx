/**
 * CacheStaleBanner — amber pressure banner rendered above the cache hero grid.
 *
 * Shown when staleRatio > STALE_CACHE_BANNER_THRESHOLD (default 25%).
 * Dismissable per-session via sessionStorage key 'dev-audit:stale-banner-dismissed'.
 *
 * Banner is distinct from the inline stale chip in CacheDashboardHero (10% threshold).
 * The chip is always visible; this banner is a heavier visual signal for high stale %.
 */
import React, { useState } from 'react';
import { T } from '../../shell/theme';
import {
  deriveStaleRatios,
  STALE_CACHE_BANNER_THRESHOLD,
} from '../../api/cache-effectiveness-types';
import type { CacheEffectivenessResponse } from '../../api/cache-effectiveness-types';

const DISMISS_KEY = 'dev-audit:stale-banner-dismissed';

interface Props {
  data: CacheEffectivenessResponse;
  /** Called when user clicks the clear-cache button. */
  onClearCache: () => void;
  /** Game scope label shown on the clear button (undefined = "all games"). */
  gameId?: string;
}

const S = {
  banner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 14px',
    marginBottom: 14,
    background: T.amberSoft,
    border: `1px solid ${T.amber500}`,
    borderRadius: 6,
    fontSize: 12,
    color: T.n800,
    fontFamily: T.fSans,
  } as React.CSSProperties,

  icon: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: '18px',
  } as React.CSSProperties,

  body: {
    flex: 1,
    lineHeight: 1.5,
  } as React.CSSProperties,

  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  } as React.CSSProperties,

  clearBtn: {
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: T.fSans,
    border: `1px solid ${T.amber500}`,
    borderRadius: 4,
    background: 'white',
    color: T.amber500,
    cursor: 'pointer',
  } as React.CSSProperties,

  dismissBtn: {
    padding: '2px 6px',
    fontSize: 11,
    fontFamily: T.fSans,
    border: 'none',
    background: 'none',
    color: T.n500,
    cursor: 'pointer',
    textDecoration: 'underline',
  } as React.CSSProperties,
};

function isSessionDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function setSessionDismissed() {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // sessionStorage unavailable — silently ignore
  }
}

export function CacheStaleBanner({ data, onClearCache, gameId }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(isSessionDismissed);

  const { staleRatio } = deriveStaleRatios(data);

  // Don't render if ratio is within threshold or user dismissed this session
  if (staleRatio <= STALE_CACHE_BANNER_THRESHOLD || dismissed) return null;

  const stalePercent = Math.round(staleRatio * 100);
  const clearLabel = gameId ? `Clear cache for game ${gameId}` : 'Clear all games cache';

  function handleDismiss() {
    setSessionDismissed();
    setDismissed(true);
  }

  function handleClear() {
    if (!window.confirm(`${clearLabel}? This will remove all stale cached responses.`)) return;
    onClearCache();
    handleDismiss();
  }

  return (
    <div style={S.banner} role="alert" data-testid="stale-cache-banner">
      <span style={S.icon}>⚠</span>
      <div style={S.body}>
        <span>
          <strong>{stalePercent}%</strong> of cached responses use an outdated cube schema.
          Stale entries waste cache storage and won&apos;t be hit.
          Clear to recover.
        </span>
        <div style={S.actions}>
          <button style={S.clearBtn} onClick={handleClear} data-testid="stale-banner-clear-btn">
            {clearLabel}
          </button>
          <button style={S.dismissBtn} onClick={handleDismiss} data-testid="stale-banner-dismiss-btn">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
