/**
 * CareMonitorBody — the shared body of the VIP-care playbook monitor.
 *
 * Extracted from CsMonitorPage so the SAME content (status sub-heading, 24h
 * activity strip, portfolio strip, playbook grid, and all loading/error/empty/
 * skeleton branches) renders identically on /dashboards/cs AND the Ops Console
 * Care tab — no re-composition drift.
 *
 * Presentational: the care hooks (`useCarePlaybooks`, `useCareDataFreshness`) are
 * NOT deduped (each call site fetches), so the hooks stay at the call sites (CS
 * page, Ops care tab) and their results are passed in here. That keeps each
 * mounted surface to a single fetch (no double-fetch / no CS regression). The
 * page-level title + "New playbook" button live in the CS page, not here.
 */

import React from 'react';
import type { CarePlaybooksState } from './use-care-playbooks';
import { distinctAsOf, formatAsOf } from './data-freshness-format';
import { PortfolioStrip } from './portfolio-strip';
import { PlaybookGrid } from './playbook-grid';
import { CsActivityStrip } from './cs-activity-strip';

interface CareMonitorBodyProps {
  gameId: string;
  care: CarePlaybooksState;
  asOfByCube: Record<string, string>;
  canWrite: boolean;
}

export function CareMonitorBody({ gameId, care, asOfByCube, canWrite }: CareMonitorBodyProps) {
  const { status, playbooks, counts, casesByPlaybook, portfolio, error } = care;
  const isLoading = status === 'idle' || status === 'loading';

  // Distinct as-of dates across queryable playbooks — flags warehouse lag at the
  // top of the page (e.g. gameplay marts run weeks behind spend/activity marts).
  const asOfDates = distinctAsOf(playbooks, asOfByCube);
  const asOfLabel =
    asOfDates.length === 1
      ? `data as of ${formatAsOf(asOfDates[0])}`
      : asOfDates.length > 1
      ? `data as of ${formatAsOf(asOfDates[0])} → ${formatAsOf(asOfDates[asOfDates.length - 1])}`
      : null;

  return (
    <>
      {/* Sub-heading */}
      <p
        style={{
          margin: '2px 0 20px',
          fontSize: 12.5,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        VIP player care program monitor.{' '}
        {status === 'success' && (
          <>
            {counts.available} live · {counts.partial} partial · {counts.unavailable} blocked
            {asOfLabel && (
              <span title="Behaviour marts lag real time. Each playbook row shows the freshest date its own data source holds.">
                {' · '}
                {asOfLabel}
              </span>
            )}
          </>
        )}
        {isLoading && 'Loading registry…'}
      </p>

      {/* Error state */}
      {status === 'error' && (
        <div
          style={{
            padding: 16,
            background: 'var(--destructive-soft)',
            color: 'var(--destructive-ink)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          Failed to load playbook registry: {error}
        </div>
      )}

      {/* 24h activity strip — treated / dismissed / resolved counts + recent feed */}
      <CsActivityStrip gameId={gameId} />

      {/* Portfolio strip — skeleton while loading */}
      <PortfolioStrip stats={portfolio} loading={isLoading} />

      {/* Playbook grid — empty state or grid */}
      {status === 'success' && playbooks.length === 0 && (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          No playbooks registered for <strong>{gameId}</strong>.
        </div>
      )}

      {status === 'success' && playbooks.length > 0 && (
        <PlaybookGrid
          playbooks={playbooks}
          casesByPlaybook={casesByPlaybook}
          gameId={gameId}
          canWrite={canWrite}
          asOfByCube={asOfByCube}
        />
      )}

      {/* Loading skeleton for grid */}
      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-xl)',
                height: 52,
                boxShadow: 'var(--shadow-sm)',
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
