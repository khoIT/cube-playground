/**
 * Per-page pull log for a served segment, newest-first, with cursor "Load older"
 * and CSV export. Each row is one authenticated page request (the grain the audit
 * stores); failed/throttled attempts appear with their status, not hidden.
 */

import { ReactElement, useState } from 'react';
import { Button, message } from 'antd';
import { Download } from 'lucide-react';
import { segmentsClient } from '../../../../../../api/segments-client';
import type { RecentPull } from '../../../../../../types/segment-api';
import { gmt7DateTime } from '../serving-format';
import { formatLatency } from './consumption-format';

interface Props {
  segmentId: string;
  initial: RecentPull[];
  initialCursor: number | null;
}

function badge(p: RecentPull): { text: string; bg: string; color: string } {
  if (p.httpStatus === 200) return { text: 'OK', bg: 'var(--success-soft)', color: 'var(--success-ink)' };
  if (p.errorCode === 'rate_limited' || p.httpStatus === 429)
    return { text: 'Rate limited', bg: 'var(--destructive-soft)', color: 'var(--destructive-ink)' };
  if (p.errorCode === 'no_snapshot' || p.httpStatus === 409)
    return { text: 'No snapshot', bg: 'var(--warning-soft)', color: 'var(--warning-ink)' };
  return { text: p.errorCode ?? String(p.httpStatus ?? '—'), bg: 'var(--muted-soft)', color: 'var(--muted-ink)' };
}

function toCsv(rows: RecentPull[]): string {
  const head = 'time_gmt7,key,status,http,error,format,page,rows,snapshot_ts,latency_ms';
  const body = rows.map((r) =>
    [
      gmt7DateTime(r.startedAt),
      r.label,
      r.httpStatus === 200 ? 'ok' : 'error',
      r.httpStatus ?? '',
      r.errorCode ?? '',
      r.format ?? '',
      r.pageIndex ?? '',
      r.rows,
      r.snapshotTs ?? '',
      r.latencyMs ?? '',
    ]
      .map((c) => {
        const s = String(c);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(','),
  );
  return [head, ...body].join('\n');
}

const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 12.5, color: 'var(--text-secondary, var(--text-primary))', whiteSpace: 'nowrap' };
const headCell: React.CSSProperties = { ...cell, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' };

export function PullLogTable({ segmentId, initial, initialCursor }: Props): ReactElement {
  const [items, setItems] = useState<RecentPull[]>(initial);
  const [cursor, setCursor] = useState<number | null>(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadOlder() {
    if (cursor == null) return;
    setLoading(true);
    try {
      const page = await segmentsClient.getPulls(segmentId, { cursor, limit: 50 });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      message.error('Failed to load older pulls');
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    const blob = new Blob([toCsv(items)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `segment-${segmentId}-pull-log.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg, 10px)', padding: '14px 16px', marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Pull log</span>
        <Button size="small" icon={<Download size={13} />} onClick={exportCsv} disabled={items.length === 0} style={{ marginLeft: 'auto' }}>
          Export log (CSV)
        </Button>
      </div>

      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          No pulls yet — share the pull recipe with a downstream app.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-card)' }}>
                <th style={{ ...headCell, textAlign: 'left' }}>Time (GMT+7)</th>
                <th style={{ ...headCell, textAlign: 'left' }}>Key</th>
                <th style={{ ...headCell, textAlign: 'left' }}>Status</th>
                <th style={{ ...headCell, textAlign: 'left' }}>Format</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Page</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Rows</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Latency</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const b = badge(p);
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-card-subtle, var(--border-card))' }}>
                    <td style={cell}>{gmt7DateTime(p.startedAt)}</td>
                    <td style={cell}>{p.label}</td>
                    <td style={cell}>
                      <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: b.bg, color: b.color }}>
                        {b.text}
                      </span>
                    </td>
                    <td style={cell}>{p.format ?? '—'}</td>
                    <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.pageIndex ?? '—'}</td>
                    <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.rows.toLocaleString()}</td>
                    <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatLatency(p.latencyMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cursor != null && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <Button size="small" onClick={loadOlder} loading={loading}>
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}
