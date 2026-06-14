/**
 * Members top-payers table — ranked by lifetime value, links into member360.
 *
 * This is the ONE Ops surface that shows per-user rows (uid + LTV) — mild PII,
 * a deliberate, user-approved product decision. It uses the isolated
 * topPayersQuery (own module) and never shares its row shape with the aggregate
 * Overview. Navigation is delegated via onOpen so it stays identical to the
 * search box's member360 route.
 */
import React from 'react';
import { useMemberCubeQuery } from '../Segments/member360/use-member-cube-query';
import { topPayersQuery } from './ops-members-queries';
import { formatVnd, formatInt, toNum } from './ops-format';

interface MembersTopPayersProps {
  gameId: string;
  onOpen: (uid: string) => void;
  limit?: number;
}

const K = {
  uid: 'mf_users.user_id',
  name: 'mf_users.ingame_name',
  tier: 'mf_users.payer_tier',
  lastLogin: 'mf_users.last_login_date',
  txns: 'mf_users.lifetime_txn_count',
  ltv: 'mf_users.ltv_total_vnd',
} as const;

/** Semantic-token badge colors per payer tier (whale = brand, etc.). */
function tierStyle(tier: string): { bg: string; color: string } {
  switch (tier.toLowerCase()) {
    case 'whale':
      return { bg: 'var(--brand-soft)', color: 'var(--brand-hover)' };
    case 'dolphin':
      return { bg: 'var(--info-soft)', color: 'var(--info-ink)' };
    case 'minnow':
      return { bg: 'var(--success-soft)', color: 'var(--success-ink)' };
    default:
      return { bg: 'var(--muted-soft)', color: 'var(--muted-ink)' };
  }
}

const th: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
  textAlign: 'left',
  padding: '11px 14px',
  background: 'var(--bg-muted)',
  fontWeight: 700,
};
const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 12.5, borderTop: '1px solid var(--border-card)' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };

export function MembersTopPayers({ gameId, onOpen, limit = 50 }: MembersTopPayersProps) {
  const query = React.useMemo(() => topPayersQuery(limit), [limit]);
  const { rows, loading, error } = useMemberCubeQuery(gameId, query);

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-card)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-sm)',
    overflow: 'hidden',
    fontFamily: 'var(--font-sans)',
  };
  const note: React.CSSProperties = { padding: 20, fontSize: 12.5, color: 'var(--text-muted)' };

  if (loading) return <div style={card}><div style={note}>Loading top payers…</div></div>;
  if (error)
    return (
      <div style={card}>
        <div style={{ ...note, color: 'var(--destructive-ink)' }}>Failed to load top payers for this game.</div>
      </div>
    );
  if (rows.length === 0) return <div style={card}><div style={note}>No payers found for this game.</div></div>;

  return (
    <div style={card}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>uid</th>
            <th style={th}>Ingame name</th>
            <th style={th}>Tier</th>
            <th style={thNum}>LTV</th>
            <th style={thNum}>Lifetime txns</th>
            <th style={thNum}>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const uid = String(r[K.uid] ?? '');
            const tier = String(r[K.tier] ?? '—');
            const ts = tierStyle(tier);
            return (
              <tr
                key={uid || i}
                onClick={() => uid && onOpen(uid)}
                style={{ cursor: uid ? 'pointer' : 'default' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brand-soft)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                <td style={td}>
                  <span
                    style={{
                      display: 'inline-flex',
                      width: 22,
                      height: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      background: i < 3 ? 'var(--brand)' : 'var(--bg-muted)',
                      color: i < 3 ? 'var(--text-on-brand)' : 'var(--text-secondary)',
                    }}
                  >
                    {i + 1}
                  </span>
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  {uid || '—'}
                </td>
                <td style={{ ...td, fontWeight: 600 }}>{String(r[K.name] ?? '—')}</td>
                <td style={td}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: ts.bg,
                      color: ts.color,
                      textTransform: 'capitalize',
                    }}
                  >
                    {tier}
                  </span>
                </td>
                <td style={tdNum}>{formatVnd(toNum(r[K.ltv]))}</td>
                <td style={tdNum}>{formatInt(toNum(r[K.txns]))}</td>
                <td style={{ ...tdNum, fontWeight: 500, color: 'var(--text-muted)' }}>
                  {String(r[K.lastLogin] ?? '').slice(0, 10) || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
