/**
 * TurnArtifactsSection — the query artifacts a turn emitted, in emit order,
 * rendered inside the chat-audit turn detail. Shared by /dev/chat-audit
 * (TurnDetail) and the /admin/dev/chat-audit cross-user panel (TurnRow).
 *
 * Design (picked from huashu variants — A+C hybrid): chat-style mini card
 * header (icon · ordinal · title · source badge · chart pill · Open in
 * Playground) with an expandable Cube-query panel decomposed into member
 * chips (artifact-query-chips.tsx) and a raw-JSON fallback.
 *
 * All colors are hermes T.* tokens (CSS vars, :root-scoped) so the section
 * renders correctly on both surfaces and in dark mode.
 */
import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { BarChart2 } from 'lucide-react';
import { T, Icon } from '../../shell/theme';
import { openArtifactInPlayground } from '../Chat/components/open-artifact-in-playground';
import { ArtifactQueryChips } from './artifact-query-chips';
import type { QueryArtifact } from '../../api/chat-sse-client';

const SOURCE_LABEL: Record<QueryArtifact['source'], string> = {
  'business-metric': 'Metric',
  segment: 'Segment',
  raw: 'Raw Query',
};

// Source badge palettes — semantic soft/ink pairs that adapt to dark mode.
const SOURCE_BADGE: Record<QueryArtifact['source'], React.CSSProperties> = {
  'business-metric': { background: T.brandSoft, color: T.brand, border: `1px solid ${T.brandBorder}` },
  segment: { background: 'var(--info-soft)', color: 'var(--info-ink)', border: '1px solid var(--info-soft)' },
  raw: { background: 'var(--muted-soft)', color: 'var(--muted-ink)', border: `1px solid ${T.n200}` },
};

const S = {
  sectionLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase' as const, color: T.brand, margin: '12px 0 6px',
  } as React.CSSProperties,
  card: {
    border: `1px solid ${T.n200}`, borderRadius: 10, overflow: 'hidden',
    background: T.surface, marginBottom: 8,
  } as React.CSSProperties,
  head: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
  } as React.CSSProperties,
  ordinal: {
    fontFamily: T.fMono, fontSize: 10, color: T.n400, minWidth: 18,
  } as React.CSSProperties,
  title: {
    fontSize: 12.5, fontWeight: 600, color: T.n900, flex: 1, minWidth: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  badge: {
    fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
    letterSpacing: '0.03em', whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  chartPill: {
    fontSize: 10, color: T.n600, background: T.surfaceSubtle,
    border: `1px solid ${T.n200}`, borderRadius: 4, padding: '1px 6px',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  openBtn: {
    fontSize: 11, padding: '2px 9px', border: `1px solid ${T.brandBorder}`,
    borderRadius: 4, background: T.brandSoft, color: T.brand, cursor: 'pointer',
    whiteSpace: 'nowrap' as const, fontWeight: 500, fontFamily: T.fSans,
  } as React.CSSProperties,
  metaRow: {
    display: 'flex', gap: 14, padding: '0 12px 8px 38px', fontSize: 11,
    color: T.n500, alignItems: 'center', flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  metaStrong: { color: T.n600, fontWeight: 600 } as React.CSSProperties,
  queryToggle: {
    fontSize: 10.5, color: T.n500, cursor: 'pointer', background: 'none',
    border: 'none', padding: 0, textDecoration: 'underline dotted', fontFamily: T.fSans,
  } as React.CSSProperties,
  queryPanel: {
    borderTop: `1px solid ${T.n100}`, background: T.surfaceSubtle, padding: '8px 12px',
  } as React.CSSProperties,
};

function ArtifactCard({ artifact, ordinal }: { artifact: QueryArtifact; ordinal: number }) {
  const history = useHistory();
  const [showQuery, setShowQuery] = useState(false);
  const sourceLabel = SOURCE_LABEL[artifact.source] ?? artifact.source;
  const badgeStyle = SOURCE_BADGE[artifact.source] ?? SOURCE_BADGE.raw;

  return (
    <div style={S.card}>
      <div style={S.head}>
        <span style={S.ordinal}>A{ordinal}</span>
        <Icon icon={BarChart2} size={15} color={T.brand} />
        <span style={S.title} title={artifact.summary || artifact.title}>{artifact.title}</span>
        <span style={{ ...S.badge, ...badgeStyle }}>{sourceLabel}</span>
        {artifact.chart && <span style={S.chartPill}>{artifact.chart.spec.type} chart</span>}
        <button
          type="button"
          style={S.openBtn}
          onClick={() => openArtifactInPlayground(artifact, history)}
        >
          Open in Playground ↗
        </button>
      </div>
      <div style={S.metaRow}>
        {artifact.game && (
          <span>game <span style={{ ...S.metaStrong, fontFamily: T.fMono }}>{artifact.game}</span></span>
        )}
        {artifact.sourceRef && (
          <span>
            ref{' '}
            <span style={{ ...S.metaStrong, fontFamily: T.fMono }}>
              {artifact.sourceRef.name ?? artifact.sourceRef.id}
            </span>
          </span>
        )}
        {artifact.previewRows != null && <span>{artifact.previewRows} preview rows</span>}
        <button type="button" style={S.queryToggle} onClick={() => setShowQuery((v) => !v)}>
          {showQuery ? '▾ Cube query' : '▸ Cube query'}
        </button>
      </div>
      {showQuery && (
        <div style={S.queryPanel}>
          <ArtifactQueryChips query={artifact.query} />
        </div>
      )}
    </div>
  );
}

interface TurnArtifactsSectionProps {
  artifacts: QueryArtifact[] | undefined;
}

export function TurnArtifactsSection({ artifacts }: TurnArtifactsSectionProps) {
  if (!artifacts || artifacts.length === 0) return null;
  return (
    <div>
      <div style={S.sectionLabel}>Artifacts ({artifacts.length})</div>
      {artifacts.map((a, i) => (
        <ArtifactCard key={a.id || i} artifact={a} ordinal={i + 1} />
      ))}
    </div>
  );
}

/** Compact "N artifacts" pill for the collapsed turn header — lets auditors
 *  scan a session for the turns that actually produced query artifacts. */
export function ArtifactCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
        background: T.brandSoft, color: T.brand, border: `1px solid ${T.brandBorder}`,
        letterSpacing: '0.04em', whiteSpace: 'nowrap',
      }}
      title={`This turn emitted ${count} query artifact${count !== 1 ? 's' : ''}`}
    >
      {count} artifact{count !== 1 ? 's' : ''}
    </span>
  );
}
