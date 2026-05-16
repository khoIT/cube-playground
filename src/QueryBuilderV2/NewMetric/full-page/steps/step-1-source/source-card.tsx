import { useRef, useState } from 'react';
import styled, { css } from 'styled-components';
import { Database, Layers, Hash, Columns3, RefreshCw, Check, Calendar } from 'lucide-react';
import type { CubeApi } from '@cubejs-client/core';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { formatRowCount, useCubeRowCount } from '../../hooks/use-cube-row-count';
import { formatTimeRange, useCubeTimeRange } from '../../hooks/use-cube-time-range';

const Card = styled.button<{ $selected: boolean }>`
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 120ms, background-color 120ms, box-shadow 120ms;
  outline: none;

  &:hover {
    border-color: var(--orange-200);
  }

  ${(p) =>
    p.$selected &&
    css`
      background: var(--brand-soft);
      border-color: var(--orange-200);
      box-shadow: 0 0 0 1px var(--orange-200) inset;
    `}
`;

const Head = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`;

const HeadLeft = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
`;

const IconTile = styled.div<{ $selected: boolean }>`
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => (p.$selected ? '#ffffff' : 'var(--bg-muted)')};
  border: 1px solid ${(p) => (p.$selected ? 'var(--orange-200)' : 'var(--border-card)')};
  color: ${(p) => (p.$selected ? 'var(--brand)' : 'var(--text-secondary)')};
`;

const TitleCol = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const Name = styled.div`
  font-family: var(--font-mono);
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
`;

const Sub = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SelectedPill = styled.span`
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid var(--orange-200);
  color: var(--brand);
  font-size: 11.5px;
  font-weight: 600;
`;

const Desc = styled.div`
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-top: 10px;
  line-height: 1.45;
`;

const ReadMore = styled.span`
  margin-left: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--brand);
  cursor: pointer;
  &:hover { text-decoration: underline; }
`;

const Stats = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
`;

const Stat = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  svg { color: var(--text-muted); }
`;

const Spacer = styled.span`
  flex: 1;
`;

const Freshness = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
`;

const TimeRangeRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-muted);
  svg { color: var(--text-muted); }
`;

const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
`;

const Tag = styled.span<{ $selected: boolean }>`
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--font-mono);
  background: ${(p) => (p.$selected ? '#ffffff' : 'var(--bg-muted)')};
  border: 1px solid ${(p) => (p.$selected ? 'var(--orange-200)' : 'transparent')};
  color: ${(p) => (p.$selected ? 'var(--brand)' : 'var(--text-secondary)')};
`;

export type SourceCardProps = {
  cube: WizardCube;
  selected: boolean;
  onSelect: () => void;
  cubeApi: CubeApi | null;
};

function cubeTags(c: WizardCube): string[] {
  const tags = new Set<string>();
  for (const m of c.measures ?? []) {
    const t = m.meta?.tags;
    if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') tags.add(x);
  }
  return Array.from(tags).slice(0, 4);
}

// Title convention: "Ballistar VN — Daily Active Snapshot" — the part before
// the em-dash is the game/source label; the part after is a per-cube subtitle.
// Falls back to the full string when no separator is present.
function gameLabelFromTitle(title: string | undefined): string | null {
  if (!title) return null;
  const sep = title.indexOf(' — ');
  if (sep > 0) return title.slice(0, sep).trim();
  const sep2 = title.indexOf(' - ');
  if (sep2 > 0) return title.slice(0, sep2).trim();
  return title.trim();
}

function firstSentence(text: string): { head: string; rest: string } {
  // Match through the first sentence terminator (. ! ?) followed by whitespace
  // or end. Avoids splitting on decimal points like "30.5%".
  const m = text.match(/^([\s\S]*?[.!?])(\s+|$)/);
  if (!m) return { head: text, rest: '' };
  const head = m[1];
  const rest = text.slice(m[0].length);
  return { head, rest: rest.trim() };
}

export function SourceCard({ cube, selected, onSelect, cubeApi }: SourceCardProps) {
  const Icon = cube.type === 'view' ? Layers : Database;
  const measures = cube.measures?.length ?? 0;
  const dims = cube.dimensions?.length ?? 0;
  const joins = cube.joins?.length ?? 0;
  const rollups = cube.preAggregations?.length ?? 0;

  const [expanded, setExpanded] = useState(false);

  // Fetch row count + time range lazily: triggered the first time this card is
  // selected, then KEPT alive afterwards so the pills survive deselection. The
  // module-level cache inside each hook means re-rendering with the same cube
  // is free (no extra round-trip).
  const wasSelectedRef = useRef(false);
  if (selected) wasSelectedRef.current = true;
  const liveCube = wasSelectedRef.current ? cube : null;
  const rowCount = useCubeRowCount(liveCube, cubeApi);
  const timeRange = useCubeTimeRange(liveCube, cubeApi);
  const isView = cube.type === 'view';
  const tags = cubeTags(cube);

  const gameLabel = gameLabelFromTitle(cube.title);
  const sub = gameLabel ?? (isView ? 'view' : 'cube');
  const desc = cube.description?.trim() ?? '';
  const { head, rest } = firstSentence(desc);

  return (
    <Card $selected={selected} onClick={onSelect} type="button">
      <Head>
        <HeadLeft>
          <IconTile $selected={selected}>
            <Icon size={15} />
          </IconTile>
          <TitleCol>
            <Name>{cube.name}</Name>
            <Sub>{sub}</Sub>
          </TitleCol>
        </HeadLeft>
        {selected && (
          <SelectedPill>
            <Check size={12} strokeWidth={2.5} />
            Selected
          </SelectedPill>
        )}
      </Head>

      {desc && (
        <Desc>
          {expanded || !rest ? desc : head}
          {rest && !expanded && (
            <ReadMore
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            >
              Read more
            </ReadMore>
          )}
          {rest && expanded && (
            <ReadMore
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
            >
              Show less
            </ReadMore>
          )}
        </Desc>
      )}

      <Stats>
        {!isView && (
          <Stat title="Approximate row count of the underlying fact table">
            <Hash size={12} strokeWidth={2} />
            {rowCount.status === 'ready' ? (
              <>
                <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {formatRowCount(rowCount.count)}
                </strong>
                <span style={{ color: 'var(--text-muted)' }}>rows</span>
              </>
            ) : rowCount.status === 'loading' ? (
              <span style={{ color: 'var(--text-muted)' }}>… rows</span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>— rows</span>
            )}
          </Stat>
        )}
        <Stat title="Total columns (dimensions + measures)">
          <Columns3 size={12} strokeWidth={2} />
          <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {measures + dims}
          </strong>
          <span style={{ color: 'var(--text-muted)' }}>cols</span>
        </Stat>
        {joins > 0 && (
          <Stat title="Joins to other cubes">
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <span>{joins} joins</span>
          </Stat>
        )}
        <Spacer />
        {rollups > 0 && (
          <Freshness title={`${rollups} pre-aggregation${rollups === 1 ? '' : 's'}`}>
            <RefreshCw size={12} strokeWidth={2} />
            rollup × {rollups}
          </Freshness>
        )}
      </Stats>

      {timeRange.status === 'ready' && (
        <TimeRangeRow title={`First → last value of ${timeRange.dimension.split('.').slice(-1)[0]}`}>
          <Calendar size={11} strokeWidth={2} />
          {formatTimeRange(timeRange.minDate, timeRange.maxDate, timeRange.spanDays)}
        </TimeRangeRow>
      )}

      {tags.length > 0 && (
        <TagRow>
          {tags.map((t) => (
            <Tag key={t} $selected={selected}>#{t}</Tag>
          ))}
        </TagRow>
      )}
    </Card>
  );
}
