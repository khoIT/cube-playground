/**
 * CacheDashboardHero — 4 hero stat cards + stale-ratio chip for the cache tab.
 *
 * Layout: 4-column CSS grid (wraps on narrow). Cards use T.* tokens throughout.
 * ONLY the "$ saved" card uses a gradient text fill — anti-slop rule enforced here.
 *
 * Stale chip sits below the grid. Amber variant fires when staleRatio > 0.10.
 */

import React from 'react';
import { T } from '../../shell/theme';
import { CacheSparkline } from './cache-sparkline';
import type { CacheEffectivenessResponse } from '../../api/cache-effectiveness-types';
import { deriveStaleRatios } from '../../api/cache-effectiveness-types';

interface Props {
  data: CacheEffectivenessResponse;
  days: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtLatencyMultiplier(hitMs: number, missMs: number): string {
  if (hitMs <= 0) return '—';
  return `${(missMs / hitMs).toFixed(1)}× faster`;
}

// ── styles ────────────────────────────────────────────────────────────────────

const S = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 12,
  } as React.CSSProperties,
  card: {
    background: 'var(--surface-raised)',
    border: `1px solid var(--shell-border)`,
    borderRadius: 8,
    padding: 16,
  } as React.CSSProperties,
  cardHero: {
    background: 'var(--surface-raised)',
    border: `1px solid var(--shell-brand-border)`,
    borderRadius: 8,
    padding: 16,
  } as React.CSSProperties,
  label: {
    fontSize: 10.5,
    color: 'var(--shell-text-subtle)',
    fontFamily: T.fMono,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  } as React.CSSProperties,
  value: {
    fontFamily: T.fMono,
    fontSize: 32,
    fontWeight: 500,
    color: 'var(--shell-text)',
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
  } as React.CSSProperties,
  valueGradient: {
    fontFamily: T.fMono,
    fontSize: 40,
    fontWeight: 500,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    // ONLY place where gradient text is allowed per design contract
    background: `linear-gradient(135deg, var(--hermes-brand) 0%, var(--hermes-brand-hover) 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  } as React.CSSProperties,
  subtext: {
    fontSize: 11,
    color: 'var(--shell-text-subtle)',
    marginTop: 6,
    fontFamily: T.fMono,
  } as React.CSSProperties,
  helpLink: {
    fontSize: 10.5,
    color: 'var(--shell-text-faint)',
    cursor: 'help',
    textDecoration: 'underline dotted',
    textDecorationThickness: 1,
    marginLeft: 4,
  } as React.CSSProperties,
  sparklineRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 4,
  } as React.CSSProperties,
  stalePill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 4,
    fontFamily: T.fMono,
    fontSize: 11,
    background: 'var(--surface-subtle)',
    color: 'var(--shell-text-secondary)',
    border: `1px solid var(--shell-border)`,
    marginBottom: 16,
  } as React.CSSProperties,
  stalePillWarn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 4,
    fontFamily: T.fMono,
    fontSize: 11,
    // Amber-soft bg — 'var(--shell-warning-soft)' token exists
    background: 'var(--shell-warning-soft)',
    color: 'var(--shell-warning)',
    border: `1px solid var(--shell-warning)`,
    marginBottom: 16,
  } as React.CSSProperties,
  staleDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'currentColor',
    flexShrink: 0,
  } as React.CSSProperties,
  latencyValue: {
    fontFamily: T.fMono,
    fontSize: 22,
    fontWeight: 500,
    color: 'var(--shell-text)',
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
  } as React.CSSProperties,
};

// ── component ─────────────────────────────────────────────────────────────────

export function CacheDashboardHero({ data, days }: Props) {
  const { summary, sparkline } = data;
  const { staleRatio, legacyRatio } = deriveStaleRatios(data.staleRatio);
  const stalePercent = Math.round(staleRatio * 100);
  const legacyCount = Math.round(legacyRatio * 100);
  const isStaleWarn = staleRatio > 0.10;

  const hitMs = summary.latencyWinMs.avgHitMs ?? 0;
  const missMs = summary.latencyWinMs.avgMissMs ?? 0;
  const hitRatePct = summary.hitRate != null ? `${Math.round(summary.hitRate * 100)}%` : '—';

  return (
    <>
      <div style={S.grid} data-testid="cache-hero-grid">
        {/* $ saved — ONLY gradient card */}
        <div style={S.cardHero} data-testid="card-dollars-saved">
          <div style={S.label}>
            $ saved
            <span
              style={S.helpLink}
              title="Estimate: original miss cost × repeat hits. Assumes hit cost ≈ miss cost."
              aria-label="Cost estimate caveat"
            >
              ?
            </span>
          </div>
          <div style={S.valueGradient}>{fmtDollars(summary.dollarsSaved)}</div>
          <div style={S.subtext}>over {days} days</div>
        </div>

        {/* hit rate */}
        <div style={S.card} data-testid="card-hit-rate">
          <div style={S.label}>hit rate</div>
          <div style={S.value}>{hitRatePct}</div>
          <div style={S.sparklineRow}>
            <CacheSparkline data={sparkline} width={110} height={22} />
            <span style={S.subtext}>last {Math.min(sparkline.length, 7)}d</span>
          </div>
        </div>

        {/* tokens saved */}
        <div style={S.card} data-testid="card-tokens-saved">
          <div style={S.label}>tokens saved</div>
          <div style={S.value}>{fmtTokens(summary.tokensSaved)}</div>
          <div style={S.subtext}>in + out · {days}d</div>
        </div>

        {/* latency win */}
        <div style={S.card} data-testid="card-latency-win">
          <div style={S.label}>latency win</div>
          <div style={S.latencyValue}>{fmtLatencyMultiplier(hitMs, missMs)}</div>
          <div style={S.subtext}>
            avg miss {(missMs / 1000).toFixed(1)}s · avg hit {(hitMs / 1000).toFixed(2)}s
          </div>
        </div>
      </div>

      {/* stale chip — always visible, amber when > 10% */}
      <div
        style={isStaleWarn ? S.stalePillWarn : S.stalePill}
        data-testid="stale-pill"
        data-warn={isStaleWarn}
      >
        <span style={S.staleDot} />
        <span>
          {stalePercent}% stale · {legacyCount} legacy
          {isStaleWarn ? ' · cube meta drifted' : ''}
        </span>
      </div>
    </>
  );
}
