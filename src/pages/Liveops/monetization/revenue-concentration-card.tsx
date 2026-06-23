/**
 * Revenue concentration / Pareto card.
 *
 * Derived from the same payer-tier snapshot as PayerTierCard. Renders a
 * cumulative-revenue vs cumulative-payers Pareto curve using recharts AreaChart
 * and surfaces key concentration callouts: "top X% of payers → Y% of revenue".
 *
 * Computation note: with only 3-4 tiers the Lorenz curve has 3-4 points.
 * The curve is honest about this coarse granularity — users should interpret
 * it as a tier-level approximation, not a per-user Pareto curve.
 */
import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { formatPct, formatVnd } from '../../OpsConsole/ops-format';
import type { PayerTierData } from './use-monetization-queries';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        {note && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{note}</div>}
      </div>
      {children}
    </div>
  );
}

interface LorenzPoint {
  /** Cumulative payer fraction 0–100 (%). */
  payerPct: number;
  /** Cumulative LTV fraction 0–100 (%). */
  ltvPct: number;
  /** Equality line (y = x). */
  equality: number;
  tierLabel: string;
}

/** Build the Lorenz curve from tier rows sorted ascending by LTV-per-user. */
function buildLorenzCurve(data: PayerTierData): LorenzPoint[] {
  const paying = data.tiers
    .filter((t) => t.tier !== 'non_payer' && t.count > 0 && t.ltv > 0)
    .sort((a, b) => a.ltv / a.count - b.ltv / b.count); // ascending avg LTV

  if (paying.length === 0) return [];

  const totalCount = paying.reduce((s, t) => s + t.count, 0);
  const totalLtv = paying.reduce((s, t) => s + t.ltv, 0);

  const points: LorenzPoint[] = [{ payerPct: 0, ltvPct: 0, equality: 0, tierLabel: 'Origin' }];
  let cumCount = 0;
  let cumLtv = 0;
  for (const t of paying) {
    cumCount += t.count;
    cumLtv += t.ltv;
    const pct = (cumCount / totalCount) * 100;
    points.push({
      payerPct: Math.round(pct * 10) / 10,
      ltvPct: Math.round((cumLtv / totalLtv) * 1000) / 10,
      equality: Math.round(pct * 10) / 10,
      tierLabel: t.tier.charAt(0).toUpperCase() + t.tier.slice(1),
    });
  }
  return points;
}

/** Concentration callout: for the top (smallest) paying tier, show payer% → revenue%. */
function topTierConcentration(data: PayerTierData): { payerPct: string; revPct: string; tier: string } | null {
  const paying = data.tiers
    .filter((t) => t.tier !== 'non_payer' && t.count > 0)
    .sort((a, b) => b.ltv / b.count - a.ltv / a.count); // desc avg LTV (whale first)

  if (paying.length === 0) return null;
  const top = paying[0];
  const payerPct = data.totalPayers > 0 ? top.count / data.totalPayers : 0;
  return {
    payerPct: formatPct(payerPct, 1),
    revPct: formatPct(top.ltvPct, 1),
    tier: top.tier.charAt(0).toUpperCase() + top.tier.slice(1),
  };
}

interface Props {
  data: PayerTierData;
}

export function RevenueConcentrationCard({ data }: Props) {
  const curve = useMemo(() => buildLorenzCurve(data), [data]);
  const callout = useMemo(() => topTierConcentration(data), [data]);

  if (curve.length < 2) {
    return (
      <Panel title="Revenue concentration (Pareto)" note="mf_users snapshot">
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Insufficient tier data to render the Pareto curve.
        </div>
      </Panel>
    );
  }

  const tooltipFormatter = (value: number, name: string) => {
    if (name === 'ltvPct') return [`${value.toFixed(1)}%`, 'Cumulative LTV'];
    if (name === 'equality') return [`${value.toFixed(1)}%`, 'Equal distribution'];
    return [value, name];
  };

  return (
    <Panel title="Revenue concentration (Pareto)" note="mf_users snapshot · tier-grain">
      {callout && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--brand-soft)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            color: 'var(--brand-hover)',
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {callout.tier}s ({callout.payerPct} of payers) account for {callout.revPct} of lifetime revenue.
          {' '}Total LTV: {formatVnd(data.totalLtv)}.
        </div>
      )}

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={curve} margin={{ top: 8, right: 16, left: 12, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" />
          <XAxis
            dataKey="payerPct"
            type="number"
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke="var(--text-muted)"
            fontSize={10}
            label={{
              value: 'Cumulative payers (%)',
              position: 'insideBottom',
              offset: -2,
              style: { fill: 'var(--text-muted)', fontSize: 10 },
            }}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke="var(--text-muted)"
            fontSize={10}
            label={{
              value: 'Cumulative LTV (%)',
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'var(--text-muted)', fontSize: 10, textAnchor: 'middle' },
            }}
          />
          <Tooltip formatter={tooltipFormatter} />
          {/* Equality line (perfectly flat distribution) */}
          <Area
            type="linear"
            dataKey="equality"
            stroke="var(--border-strong)"
            fill="none"
            strokeDasharray="4 3"
            dot={false}
            strokeWidth={1}
          />
          {/* Lorenz curve */}
          <Area
            type="monotone"
            dataKey="ltvPct"
            stroke="var(--brand)"
            fill="var(--brand-soft)"
            fillOpacity={0.4}
            strokeWidth={2}
            dot={{ r: 4, fill: 'var(--brand)', stroke: 'var(--bg-card)', strokeWidth: 2 }}
          />
          {/* 80% payer marker */}
          <ReferenceLine x={80} stroke="var(--warning-ink)" strokeDasharray="3 3" />
        </AreaChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        Lorenz curve built from {data.tiers.filter((t) => t.tier !== 'non_payer').length} paying tiers.
        Coarse granularity — tier-level approximation, not per-user. Gini ≈ {data.giniApprox.toFixed(2)}.
      </div>
    </Panel>
  );
}
