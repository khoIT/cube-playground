/**
 * Overview tab — window-aware payment + identity 360 (aggregate, no PII).
 * Built only on measures verified populated by the 2026-06-14 data audit:
 * cash / transactions / paying users + daily trends, gateway mix, support health
 * (status-independent), lifetime reconciliation (snapshot), cross-border geo
 * signal, and acquisition spend + blended ROAS. Δ-vs-prior shows on 7d only.
 *
 * The interactive trend grid lives in OverviewTrends (this file keeps the hero
 * KPIs + analysis panels). Accepts an optional custom date range; when set, the
 * window is 'custom' and there is no Δ-vs-prior (same as 30d/MTD).
 */
import React from 'react';
import type { OpsWindow, OpsRange } from './ops-window';
import { useOpsOverview } from './use-ops-overview';
import { OpsStatCard } from './ops-stat-card';
import { OverviewTrends } from './overview-trends';
import { formatVnd, formatInt, formatCompact, formatPct } from './ops-format';

const sectionGap = 20;

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-sm)',
        padding: 16,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        {note && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{note}</div>}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '6px 0',
        borderBottom: '1px solid var(--border-card)',
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 700, color: accent ?? 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

interface OverviewTabProps {
  gameId: string;
  window: OpsWindow;
  customRange?: OpsRange;
}

export function OverviewTab({ gameId, window, customRange }: OverviewTabProps) {
  const d = useOpsOverview(gameId, window, customRange);
  const loading = d.loading;
  // Δ-vs-prior is only meaningful on 7d (presets ≥30d and custom have no prior).
  const deltaNote = window === '7d' ? 'Δ vs prior 7d' : 'no Δ on this window';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sectionGap }}>
      {/* Query failure — show a banner instead of silent zeros (a renamed/missing
          measure must not read as "₫0"). */}
      {d.error && !loading && (
        <div
          style={{
            padding: 14,
            background: 'var(--destructive-soft)',
            color: 'var(--destructive-ink)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            fontFamily: 'var(--font-sans)',
          }}
        >
          Some Ops data failed to load for this game/window — values below may be incomplete.
        </div>
      )}

      {/* Hero KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <OpsStatCard
          label="Cash collected"
          value={formatVnd(d.headline.cash)}
          delta={d.headline.cashDelta}
          sub={deltaNote}
          loading={loading}
        />
        <OpsStatCard
          label="Transactions"
          value={formatInt(d.headline.txns)}
          delta={d.headline.txnsDelta}
          sub={deltaNote}
          loading={loading}
        />
        <OpsStatCard
          label="Paying users"
          value={formatCompact(d.headline.payers)}
          delta={d.headline.payersDelta}
          sub="distinct over window"
          loading={loading}
        />
        <OpsStatCard
          label="Support tickets"
          value={formatInt(d.support.tickets)}
          sub={`CSAT ${d.support.csat ? d.support.csat.toFixed(1) : '—'} · ~2d lag`}
          loading={loading}
        />
        <OpsStatCard
          label="Ad spend"
          value={formatVnd(d.acquisition.spend)}
          sub={
            d.acquisition.blendedRoas != null
              ? `≈${d.acquisition.blendedRoas.toFixed(1)}× blended ROAS`
              : 'rev ÷ spend'
          }
          loading={loading}
        />
      </div>

      {/* Trends — interactive chart grid (max 2/row + 2 full-width). */}
      <OverviewTrends d={d} loading={loading} />

      {/* Analysis panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <Panel title="Payment gateway mix" note="this window">
          {d.gatewayMix.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No gateway data in window.</div>
          ) : (
            d.gatewayMix.map((g) => (
              <Row key={g.gateway} label={g.gateway} value={`${formatVnd(g.cash)} · ${formatPct(g.pct)}`} />
            ))
          )}
        </Panel>

        <Panel title="Support health" note="cs_ticket_detail · ~2d lag">
          <Row label="Tickets" value={formatInt(d.support.tickets)} />
          <Row label="CSAT (avg)" value={d.support.csat ? d.support.csat.toFixed(2) : '—'} />
          <Row
            label="Negative sentiment"
            value={formatInt(d.support.negative)}
            accent="var(--destructive-ink)"
          />
          <Row label="Unmapped to member (≈FB)" value={formatInt(d.support.unresolvedMember)} />
          <Row
            label="Avg resolution"
            value={d.support.avgResolution ? `${d.support.avgResolution.toFixed(1)}h` : '—'}
          />
        </Panel>

        <Panel title="Lifetime reconciliation" note="as-of snapshot · gross only">
          <Row label="Gateway-charged lifetime" value={formatVnd(d.recon.gatewayLifetime)} />
          <Row label="Ingame-delivered LTV" value={formatVnd(d.recon.ingameLtv)} />
          <Row
            label="Structural wedge"
            value={formatPct(d.recon.gapPct)}
            accent="var(--warning-ink)"
          />
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>
            Gateway gross vs ingame delivery — not a leak; fees / FX / unspent balance.
          </div>
        </Panel>

        <Panel title="Acquisition &amp; spend" note="marketing_cost · blended">
          <Row label="Spend" value={formatVnd(d.acquisition.spend)} />
          <Row label="CPC" value={formatVnd(d.acquisition.cpc)} />
          <Row label="CPM" value={formatVnd(d.acquisition.cpm)} />
          <Row
            label="Blended ROAS"
            value={d.acquisition.blendedRoas != null ? `${d.acquisition.blendedRoas.toFixed(1)}×` : '—'}
            accent="var(--success-ink)"
          />
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>
            revenue ÷ spend (blended, not cohort). Cohort ROAS/CPI needs a paid-install join (deferred).
          </div>
        </Panel>

        <Panel title="Cross-border signal" note="mf_users · snapshot">
          <Row label="Movers (first ≠ last login country)" value={formatInt(d.geo.movers)} />
          <Row label="Share of all users" value={formatPct(d.geo.moverPct, 2)} />
          <Row label="Mover LTV" value={formatVnd(d.geo.moverLtv)} />
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>
            Travel / VPN / account-sharing proxy — not residence. Count + LTV only (selection bias).
          </div>
        </Panel>
      </div>
    </div>
  );
}
