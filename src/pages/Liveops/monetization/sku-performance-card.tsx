/**
 * SKU/pack performance card.
 *
 * Shows top SKUs by VND revenue using BarList. Gated by game:
 *   - cfm_vn: groups by product_id, revenue = recharge.revenue_vnd_real (bridged)
 *   - jus_vn: groups by product_name, revenue = recharge.revenue_vnd (VND filter applied server-side)
 *   - all others: renders a disclosed-empty "SKU data not available" state
 *
 * The notAvailable flag + reason come from the server so the client doesn't need
 * to maintain a game allowlist independently.
 */
import React from 'react';
import { BarList, type BarListItem } from '../../Segments/visuals/bar-list';
import { formatVnd, formatInt } from '../../OpsConsole/ops-format';
import type { SkuData } from './use-monetization-queries';

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

interface Props {
  data: SkuData;
}

export function SkuPerformanceCard({ data }: Props) {
  if (data.notAvailable) {
    return (
      <Panel title="SKU / pack performance" note="recharge cube">
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--muted-soft)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            color: 'var(--muted-ink)',
          }}
        >
          SKU data not available.{data.notAvailableReason ? ` ${data.notAvailableReason}` : ''}
        </div>
      </Panel>
    );
  }

  if (data.rows.length === 0) {
    return (
      <Panel title="SKU / pack performance" note="recharge cube">
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          No SKU revenue data found. The recharge table may be empty or unbridged for this game.
        </div>
      </Panel>
    );
  }

  const maxRevenue = Math.max(...data.rows.map((r) => r.revenue), 1);

  const items: BarListItem[] = data.rows.map((r) => ({
    label: r.productName || r.productId || '(unknown)',
    value: r.revenue,
    color: 'var(--brand)',
  }));

  return (
    <Panel title="SKU / pack performance" note="recharge · VND · top 20">
      <BarList items={items} max={maxRevenue} />

      {/* Detailed table below the bar list */}
      <div style={{ marginTop: 14, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['#', 'Product', 'Revenue (VND)', 'Transactions'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i >= 2 ? 'right' : 'left',
                    padding: '6px 10px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-muted)',
                    borderBottom: '1px solid var(--border-card)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.productId + i}>
                <td style={{ padding: '7px 10px', color: 'var(--text-muted)', fontSize: 11, borderBottom: '1px solid var(--border-card)' }}>
                  {i + 1}
                </td>
                <td
                  style={{
                    padding: '7px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                    borderBottom: '1px solid var(--border-card)',
                    maxWidth: 220,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={r.productName !== r.productId ? `${r.productName} (${r.productId})` : r.productId}
                >
                  {r.productName || r.productId}
                  {r.productName && r.productName !== r.productId && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 10 }}>
                      {r.productId}
                    </span>
                  )}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--border-card)' }}>
                  {formatVnd(r.revenue)}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--border-card)' }}>
                  {formatInt(r.txnCount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        Revenue is lifetime cumulative VND (all-time, no date filter).
        jus_vn rows filtered to currency=VND to exclude mixed USD transactions.
        cfm_vn uses bridged revenue_vnd_real (excludes test/unbridged transactions).
      </div>
    </Panel>
  );
}
