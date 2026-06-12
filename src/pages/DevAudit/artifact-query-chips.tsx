/**
 * ArtifactQueryChips — decomposes a QueryArtifact's CubeQuery into member
 * chips (measures / dimensions / time / filters / segments) so auditors can
 * read the query at a glance without parsing JSON. The raw JSON stays one
 * click away as a fallback for anything the chip summary can't express.
 */
import React, { useState } from 'react';
import { T } from '../../shell/theme';

// Defensive shape for the artifact's CubeQuery (typed `unknown` on the DTO).
interface TimeDimensionShape {
  dimension?: string;
  granularity?: string;
  dateRange?: string | string[];
}
interface FilterShape {
  member?: string;
  dimension?: string;
  operator?: string;
  values?: unknown[];
  and?: FilterShape[];
  or?: FilterShape[];
}
interface CubeQueryShape {
  measures?: string[];
  dimensions?: string[];
  segments?: string[];
  timeDimensions?: TimeDimensionShape[];
  filters?: FilterShape[];
}

const chipBase: React.CSSProperties = {
  display: 'inline-block', fontFamily: T.fMono, fontSize: 10,
  padding: '2px 7px', borderRadius: 4, margin: '0 4px 4px 0',
  background: T.surface, border: `1px solid ${T.n200}`, color: T.n600,
};
const chipMeasure: React.CSSProperties = {
  ...chipBase, background: T.brandSoft, border: `1px solid ${T.brandBorder}`, color: T.brand,
};
const chipTime: React.CSSProperties = {
  ...chipBase, background: 'var(--info-soft)', border: '1px solid var(--info-soft)', color: 'var(--info-ink)',
};
const groupLabelStyle: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: T.n400, margin: '6px 0 3px',
};
const rawToggleStyle: React.CSSProperties = {
  fontSize: 10, color: T.n400, cursor: 'pointer', background: 'none',
  border: 'none', padding: 0, textDecoration: 'underline dotted',
  fontFamily: T.fSans, marginTop: 4, display: 'block',
};
const rawPreStyle: React.CSSProperties = {
  fontFamily: T.fMono, fontSize: 10.5, whiteSpace: 'pre-wrap',
  wordBreak: 'break-all', maxHeight: 240, overflowY: 'auto',
  background: T.surface, padding: '8px 10px', borderRadius: 4,
  border: `1px solid ${T.n200}`, color: T.n600, marginTop: 6,
};

function formatTimeDimension(td: TimeDimensionShape): string {
  const range = Array.isArray(td.dateRange) ? td.dateRange.join(' → ') : td.dateRange;
  return [td.dimension, td.granularity, range].filter(Boolean).join(' · ') || '(time dimension)';
}

function formatFilter(f: FilterShape): string {
  // Boolean groups summarize; leaf conditions render "member op values".
  if (f.and) return `AND · ${f.and.length} conditions`;
  if (f.or) return `OR · ${f.or.length} conditions`;
  const member = f.member ?? f.dimension ?? '(member)';
  const values = Array.isArray(f.values) ? f.values.map(String).join(', ') : '';
  return [member, f.operator, values].filter(Boolean).join(' ');
}

interface ChipGroup {
  label: string;
  style: React.CSSProperties;
  texts: string[];
}

export function ArtifactQueryChips({ query }: { query: unknown }) {
  const [showRaw, setShowRaw] = useState(false);
  const q = (query && typeof query === 'object' ? query : {}) as CubeQueryShape;

  const groups: ChipGroup[] = [
    { label: 'Measures', style: chipMeasure, texts: q.measures ?? [] },
    { label: 'Dimensions', style: chipBase, texts: q.dimensions ?? [] },
    { label: 'Time', style: chipTime, texts: (q.timeDimensions ?? []).map(formatTimeDimension) },
    { label: 'Filters', style: chipBase, texts: (q.filters ?? []).map(formatFilter) },
    { label: 'Segments', style: chipBase, texts: q.segments ?? [] },
  ].filter((g) => g.texts.length > 0);

  return (
    <div>
      {groups.length === 0 && (
        <span style={{ fontSize: 11, color: T.n400 }}>Empty query — see raw JSON.</span>
      )}
      {groups.map((g) => (
        <div key={g.label}>
          <div style={groupLabelStyle}>{g.label}</div>
          {g.texts.map((text, i) => (
            <span key={`${g.label}-${i}`} style={g.style}>{text}</span>
          ))}
        </div>
      ))}
      <button type="button" style={rawToggleStyle} onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? 'hide raw JSON' : 'view raw JSON'}
      </button>
      {showRaw && <pre style={rawPreStyle}>{JSON.stringify(query ?? null, null, 2)}</pre>}
    </div>
  );
}
