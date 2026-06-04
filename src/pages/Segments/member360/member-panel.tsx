/**
 * Generic 360 panel renderer. One component dispatches all panel types:
 *   - `profile`      → KPI stat cards + a key/value vitals grid (one row)
 *   - everything else → a compact table (daily/monthly timeline, detail, event)
 *
 * Fires one live Cube query for the panel (via useMemberCubeQuery) from the
 * config + identity values the parent passes (uid, or bridged role_ids).
 */

import { ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import type { Member360Panel } from './member360-panels';
import { buildPanelQuery, type DateRange } from './build-panel-query';
import { useMemberCubeQuery } from './use-member-cube-query';
import { formatCell } from './format-cell';

interface Props {
  gameId: string | null;
  panel: Member360Panel;
  /** Identity values: `[uid]` for user_id/clientsdkuserid, role_ids for playerid. */
  idValues: string[];
  dateRange?: DateRange;
  /** Skip the query (lazy panel not yet expanded). */
  idle?: boolean;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

export function MemberPanel({ gameId, panel, idValues, dateRange, idle }: Props): ReactElement {
  const { t } = useTranslation();
  const query = useMemo(
    () => (idle ? null : buildPanelQuery(panel, idValues, dateRange)),
    [panel, idValues, dateRange, idle],
  );
  const { rows, loading, error } = useMemberCubeQuery<Record<string, unknown>>(gameId, query);

  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
        {panel.title}
      </h3>
      {panel.pii && (
        <span
          title={t('segments.member360.piiTooltip', {
            defaultValue: 'Contains personally identifiable information',
          })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            color: 'var(--warning-ink)',
            background: 'var(--warning-soft)',
            padding: '1px 6px',
            borderRadius: 999,
          }}
        >
          <ShieldAlert size={11} aria-hidden /> PII
        </span>
      )}
      {!loading && rows.length > 0 && panel.panelType !== 'profile' && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {t('segments.member360.rowCount', { defaultValue: '{{n}} rows', n: rows.length })}
        </span>
      )}
    </div>
  );

  let body: ReactElement;
  if (error) {
    body = <Empty text={t('segments.member360.error', { defaultValue: 'Failed to load' })} tone="error" />;
  } else if (loading && rows.length === 0) {
    body = <Empty text={t('segments.member360.loading', { defaultValue: 'Loading…' })} />;
  } else if (rows.length === 0) {
    body = <Empty text={t('segments.member360.empty', { defaultValue: 'No data in this window' })} />;
  } else if (panel.panelType === 'profile') {
    body = <ProfileBody panel={panel} row={rows[0]} />;
  } else {
    body = <TableBody panel={panel} rows={rows} />;
  }

  return (
    <section style={cardStyle}>
      {title}
      {body}
    </section>
  );
}

function ProfileBody({ panel, row }: { panel: Member360Panel; row: Record<string, unknown> }): ReactElement {
  return (
    <div>
      {panel.kpis && panel.kpis.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 10,
            marginBottom: 16,
          }}
        >
          {panel.kpis.map((k) => (
            <div
              key={k.member}
              style={{
                background: 'var(--bg-subtle, var(--bg-card))',
                border: '1px solid var(--border-subtle, var(--border-card))',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatCell(row[k.member], k.format)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '8px 20px',
        }}
      >
        {panel.columns.map((c) => (
          <div key={c.member} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{c.label}</span>
            <span
              style={{
                fontSize: 13,
                color: 'var(--text-primary)',
                fontFamily: c.member.endsWith('.user_id') ? 'var(--font-mono)' : undefined,
              }}
            >
              {formatCell(row[c.member], c.format)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableBody({ panel, rows }: { panel: Member360Panel; rows: Record<string, unknown>[] }): ReactElement {
  const cols = panel.timeDimension
    ? [
        panel.columns.find((c) => c.member === panel.timeDimension) ??
          { member: panel.timeDimension, label: 'When', kind: 'dimension' as const },
        ...panel.columns.filter((c) => c.member !== panel.timeDimension),
      ]
    : panel.columns;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.member}
                style={{
                  textAlign: 'left',
                  padding: '6px 10px',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  borderBottom: '1px solid var(--border-card)',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td
                  key={c.member}
                  style={{
                    padding: '6px 10px',
                    color: 'var(--text-primary)',
                    borderBottom: '1px solid var(--border-subtle, var(--border-card))',
                    whiteSpace: 'nowrap',
                    fontFamily: c.pii ? 'var(--font-mono)' : undefined,
                  }}
                >
                  {formatCell(r[c.member], c.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text, tone }: { text: string; tone?: 'error' }): ReactElement {
  return (
    <div
      style={{
        fontSize: 12,
        color: tone === 'error' ? 'var(--destructive-ink, var(--text-muted))' : 'var(--text-muted)',
        padding: '8px 0',
      }}
    >
      {text}
    </div>
  );
}
