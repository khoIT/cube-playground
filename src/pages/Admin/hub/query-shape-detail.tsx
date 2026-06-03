/**
 * QueryShapeDetail — renders a recorded, privacy-safe query shape with its
 * actual member names and an "Open in playground" deep-link.
 *
 * The persisted shape is member NAMES only (no filter values / date ranges /
 * UIDs — privacy allowlist). Listing the measure & dimension names is the most
 * detail that exists; the deep-link re-opens those members in the Query
 * playground so an admin can inspect or re-run the shape. tokens.css only.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { buildShapePlaygroundUrl, summarizeShapeMembers, type QueryShape } from './per-user-panel-helpers';

const memberChip: React.CSSProperties = {
  fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  background: 'var(--bg-app)', border: '1px solid var(--border-card)',
  color: 'var(--text-secondary)', padding: '1px 6px', borderRadius: 'var(--radius-sm)',
};

const playgroundLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 11.5, fontWeight: 600, color: 'var(--brand)',
  textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
};

function MemberList({ label, members }: { label: string; members: string[] }) {
  if (members.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', flexShrink: 0 }}>
        {label}
      </span>
      {members.map((m) => <span key={m} style={memberChip}>{m}</span>)}
    </div>
  );
}

/** Full card: cube header + measure/dimension member names + playground link. */
export function QueryShapeDetail({ shape }: { shape: QueryShape }) {
  const url = buildShapePlaygroundUrl(shape);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-muted)', padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {shape.cubes.length > 0 ? shape.cubes.join(', ') : 'query'}
        </span>
        {url && (
          <Link to={url} title="Open these members in the Query playground" style={playgroundLink}>
            Open in playground <ExternalLink size={12} />
          </Link>
        )}
      </div>
      <MemberList label="Measures" members={shape.measures} />
      <MemberList label="Dimensions" members={shape.dimensions} />
    </div>
  );
}

/** Compact one-line variant for the session timeline event list: the selected
 *  members as a single playground link (counts alone don't say "what"). */
export function QueryShapeInline({ shape }: { shape: QueryShape }) {
  const url = buildShapePlaygroundUrl(shape);
  const text = (
    <span style={{ fontSize: 11.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--text-secondary)' }}>
      {summarizeShapeMembers(shape)}
    </span>
  );
  if (!url) return text;
  return (
    <Link to={url} title="Open in Query playground" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, textDecoration: 'none', minWidth: 0 }}>
      {text}
      <ExternalLink size={11} style={{ color: 'var(--brand)', flexShrink: 0, alignSelf: 'center' }} />
    </Link>
  );
}
