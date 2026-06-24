/**
 * MonetizationPage — /liveops/monetization
 *
 * Monetization economics: payer-tier distribution, realized LTV-by-cohort,
 * revenue concentration (Pareto + Gini), and SKU/pack performance (cfm/jus only).
 *
 * All data is aggregate-only (no per-user PII). Cards map 1-to-1 to server
 * endpoints under /api/monetization/*. The tier-migration card populates from a
 * self-join of the two latest daily member-state snapshots; until two days are
 * captured (or where the snapshot read is disabled) it shows an honest
 * disclosed-empty state rather than fabricated numbers.
 *
 * Page-header pattern mirrors Dashboards / Cohort / Diagnostics pages.
 */
import React from 'react';
import { CircleDollarSign } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import {
  usePayerTiers,
  useCohortLtv,
  useSkuPerformance,
  useTierMigration,
} from './use-monetization-queries';
import { PayerTierCard } from './payer-tier-card';
import { RevenueConcentrationCard } from './revenue-concentration-card';
import { LtvCohortCard } from './ltv-cohort-card';
import { SkuPerformanceCard } from './sku-performance-card';
import { TierMigrationCard } from './tier-migration-card';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

/** Skeleton placeholder while a card loads. */
function CardSkeleton({ label }: { label: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-xl)',
        padding: 16,
        minHeight: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 12.5,
      }}
    >
      Loading {label}…
    </div>
  );
}

/** Error card for a failed endpoint. */
function CardError({ label, error }: { label: string; error: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-xl)',
        padding: 16,
        color: 'var(--destructive-ink)',
        fontSize: 12.5,
      }}
    >
      Failed to load {label}: {error}
    </div>
  );
}

export function MonetizationPage() {
  const { gameId } = useGameContext();

  const tiers = usePayerTiers(gameId);
  const cohort = useCohortLtv(gameId);
  const sku = useSkuPerformance(gameId);
  const migration = useTierMigration(gameId);

  return (
    <div style={pageStyle}>
      {/* Page header — eyebrow + icon + title */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 6,
        }}
      >
        Live operations · {gameId}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <CircleDollarSign size={20} style={{ color: 'var(--brand)' }} />
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.005em',
          }}
        >
          Monetization
        </h1>
      </div>

      {/* Card grid — 2 columns on large, 1 on narrow */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Row 1: payer tiers + revenue concentration (side-by-side) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 20 }}>
          {tiers.loading ? (
            <CardSkeleton label="payer tiers" />
          ) : tiers.error ? (
            <CardError label="payer tiers" error={tiers.error} />
          ) : tiers.data ? (
            <PayerTierCard data={tiers.data} />
          ) : null}

          {tiers.loading ? (
            <CardSkeleton label="revenue concentration" />
          ) : tiers.error ? (
            <CardError label="revenue concentration" error={tiers.error} />
          ) : tiers.data ? (
            <RevenueConcentrationCard data={tiers.data} />
          ) : null}
        </div>

        {/* Row 2: realized LTV by cohort (full width) */}
        {cohort.loading ? (
          <CardSkeleton label="LTV by cohort" />
        ) : cohort.error ? (
          <CardError label="LTV by cohort" error={cohort.error} />
        ) : cohort.data ? (
          <LtvCohortCard data={cohort.data} />
        ) : null}

        {/* Row 3: tier migration + SKU performance (side-by-side) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 20 }}>
          {migration.loading ? (
            <CardSkeleton label="tier migration" />
          ) : migration.error ? (
            <CardError label="tier migration" error={migration.error} />
          ) : migration.data ? (
            <TierMigrationCard data={migration.data} />
          ) : null}

          {sku.loading ? (
            <CardSkeleton label="SKU performance" />
          ) : sku.error ? (
            <CardError label="SKU performance" error={sku.error} />
          ) : sku.data ? (
            <SkuPerformanceCard data={sku.data} />
          ) : null}
        </div>

      </div>
    </div>
  );
}
