/**
 * Entered/left VIP drill for the sweep diff — lists the VIPs that joined (B\A)
 * or left (A\B) a playbook's cohort between two runs, paginated 50/page and
 * profile-enriched. Clicking a VIP opens their Member-360. Reuses QueuePager.
 */

import { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { QueuePager } from './queue-pager';
import { ltvLabel } from './case-ledger-format';
import { useSweepDiffVips } from './use-care-sweeps';

interface DrillProps {
  gameId: string;
  runA: string;
  runB: string;
  playbookId: string;
  direction: 'entered' | 'left';
}

export function SweepsVipDrill({ gameId, runA, runB, playbookId, direction }: DrillProps) {
  const history = useHistory();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [runA, runB, playbookId, direction]);
  const { status, vips, total, pageSize, membershipAvailable, error } = useSweepDiffVips(
    gameId, runA, runB, playbookId, direction, page,
  );

  if (status === 'error') {
    return <div style={{ padding: 12, color: 'var(--destructive-ink)', fontSize: 13 }}>Failed to load VIPs: {error}</div>;
  }
  if (!membershipAvailable) {
    return (
      <div style={{ padding: 12, background: 'var(--warning-soft)', color: 'var(--warning-ink)', borderRadius: 'var(--radius-md)', fontSize: 12.5, fontFamily: 'var(--font-sans)' }}>
        Membership snapshot for one of these runs was pruned — only the counts are available, not the per-VIP list.
      </div>
    );
  }
  if (status === 'success' && vips.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>No VIPs {direction} for this playbook.</div>;
  }

  const tint = direction === 'entered' ? 'var(--success-ink)' : 'var(--destructive-ink)';

  return (
    <div style={{ border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: tint, fontFamily: 'var(--font-sans)', borderBottom: '1px solid var(--border-card)' }}>
        {direction === 'entered' ? 'Entered' : 'Left'} · {total.toLocaleString()} VIP{total === 1 ? '' : 's'}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {vips.map((v) => {
            const p = v.profile;
            return (
              <tr
                key={v.uid}
                onClick={() => history.push(`/dashboards/cs/members/${encodeURIComponent(v.uid)}?game=${encodeURIComponent(gameId)}`)}
                style={{ cursor: 'pointer', borderTop: '1px solid var(--border-card)' }}
              >
                <td style={{ padding: '8px 14px', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
                  <span style={{ fontWeight: 600 }}>{p?.name ?? v.uid}</span>
                  {p && (
                    <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: 12 }}>
                      {[ltvLabel(p.ltvVnd), p.tier].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <QueuePager page={page} pageSize={pageSize} total={total} onPage={setPage} unit="VIPs" />
    </div>
  );
}
