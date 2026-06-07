/**
 * 360 hero banner — gradient header with avatar, member id, derived badge chips
 * and 4 headline KPI pills. Mirrors the cfm-user360 reference layout on an
 * on-brand gradient (orange family via tokens, not the reference's purple).
 */

import { ReactElement } from 'react';
import type { Member360Sections } from '../member360-sections';
import { qualify } from '../member360-sections';
import { formatCell, formatCellExact } from '../format-cell';

interface Props {
  uid: string;
  sections: Member360Sections;
  row: Record<string, unknown> | null;
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
  fontWeight: 600,
  color: '#fff',
  background: 'rgba(255,255,255,0.18)',
  padding: '3px 10px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

export function DashboardHero({ uid, sections, row }: Props): ReactElement {
  const chips: ReactElement[] = [];
  if (row) {
    for (const b of sections.badges) {
      const v = row[qualify(b.field)];
      if (b.kind === 'flag') {
        const truthy = v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
        if (truthy) chips.push(<span key={b.field} style={chipStyle}>{b.icon} {b.flagLabel}</span>);
      } else if (v != null && v !== '') {
        chips.push(<span key={b.field} style={chipStyle}>{b.icon} {String(v)}</span>);
      }
    }
    if (sections.locationFields) {
      const [a, b] = sections.locationFields.map((f) => row[qualify(f)]).map((x) => (x == null ? '' : String(x)));
      const loc = [a, b].filter(Boolean).join(' · ');
      if (loc) chips.push(<span key="loc" style={chipStyle}>📍 {loc}</span>);
    }
  }

  return (
    <div
      style={{
        background: 'linear-gradient(120deg, var(--brand) 0%, var(--brand-hover) 100%)',
        borderRadius: 'var(--radius-xl)',
        padding: '20px 24px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 20,
        marginBottom: 24,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 'var(--radius-lg)',
          background: 'rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 30,
          flexShrink: 0,
        }}
      >
        🐳
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: '#fff',
            fontFamily: 'var(--font-mono)',
            wordBreak: 'break-all',
            marginBottom: 8,
          }}
        >
          {uid}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{chips}</div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {sections.pills.map((p) => (
          <div
            key={p.field}
            style={{
              background: 'rgba(255,255,255,0.16)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 14px',
              minWidth: 90,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.8)',
                marginBottom: 3,
              }}
            >
              {p.label}
            </div>
            <div
              style={{ fontSize: 17, fontWeight: 700, color: '#fff', cursor: row && formatCellExact(row[qualify(p.field)], p.format) ? 'help' : undefined }}
              title={row ? formatCellExact(row[qualify(p.field)], p.format) ?? undefined : undefined}
            >
              {row ? formatCell(row[qualify(p.field)], p.format) : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
