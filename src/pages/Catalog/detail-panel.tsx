/**
 * DetailPanel — the cube drawer shown beside the join graph and the card grid.
 * Mirrors the standalone model-viewer drawer: a compact header + (clamped)
 * description, a Joins / Pre-aggregations segmented row (two tabs on one line so
 * the structure metadata costs one short block, not two stacked sections), then
 * the primary Dimensions / Measures / Segments tabs whose rows link into the
 * catalog. Keeping the structure metadata to one tabbed block means the member
 * tabs stay near the top — visible without scrolling for most cubes.
 *
 * There is intentionally no "Open in Playground" action — every member row is
 * itself a link to its catalog artifact (metric card / concept page), which is
 * the canonical way to query from here.
 */
import { useState } from 'react';
import styled from 'styled-components';
import { X } from 'lucide-react';

import { CatalogCube } from './use-catalog-meta';
import { DetailPanelMembers, type MemberTab } from './detail-panel-members';
import { clusterAccent, clusterShortLabel } from './cube-graph/cube-clusters';
import { clusterOf, parseKeyLabel } from './cube-graph/build-join-graph';

const Panel = styled.aside`
  width: 400px;
  flex-shrink: 0;
  background: var(--bg-card);
  border-left: 1px solid var(--border-card);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

/** Full-width cluster-color bar tying the pane to its node + legend swatch. */
const AccentBar = styled.div<{ $accent: string }>`
  height: 3px;
  background: ${(p) => p.$accent};
  flex-shrink: 0;
`;

const Header = styled.header`
  padding: 16px 16px 14px;
  border-bottom: 1px solid var(--border-card);
  position: relative;
  flex-shrink: 0;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-right: 24px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-primary);
  word-break: break-all;
`;

const TypeChip = styled.span`
  font-size: 10px;
  font-weight: 600;
  font-family: var(--font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: var(--radius-full);
  background: var(--pill-mono-bg);
  color: var(--text-muted);
`;

const ClusterChip = styled.span<{ $accent: string }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 600;
  font-family: var(--font-sans);
  padding: 2px 8px 2px 7px;
  border-radius: var(--radius-full);
  color: ${(p) => p.$accent};
  background: color-mix(in srgb, ${(p) => p.$accent} 12%, var(--bg-card));

  &::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: ${(p) => p.$accent};
  }
`;

const CloseBtn = styled.button`
  position: absolute;
  top: 14px;
  right: 14px;
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;

  &:hover {
    color: var(--text-primary);
  }
`;

const Description = styled.p<{ $clamp: boolean }>`
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
  ${(p) =>
    p.$clamp
      ? `display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;`
      : ''}
`;

const MoreToggle = styled.button`
  appearance: none;
  background: transparent;
  border: 0;
  padding: 3px 0 0;
  cursor: pointer;
  font-size: 11px;
  color: var(--brand);

  &:hover {
    text-decoration: underline;
  }
`;

/** Joins / Pre-aggregations segmented control — two tabs on one row. */
const SegRow = styled.div`
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-card);
  flex-shrink: 0;
`;

const SegBtn = styled.button<{ $active: boolean }>`
  appearance: none;
  cursor: pointer;
  flex: 1;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-sans);
  border-radius: var(--radius-input);
  border: 1px solid ${(p) => (p.$active ? 'var(--border-strong)' : 'transparent')};
  background: ${(p) => (p.$active ? 'var(--bg-card)' : 'var(--pill-mono-bg)')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-muted)')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;

  &:hover {
    color: var(--text-primary);
  }
`;

const SegCount = styled.span`
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
`;

/** Body for the structure segment; capped so member tabs stay near the top. */
const StructureBody = styled.div`
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 150px;
  overflow-y: auto;
  flex-shrink: 0;
`;

const JoinRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const JoinHead = styled.div`
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
`;

const JoinTarget = styled.code`
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-primary);
`;

const JoinRel = styled.span`
  font-size: 10px;
  color: var(--text-muted);
`;

const JoinKey = styled.code`
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-secondary);
`;

const TabBar = styled.div`
  display: flex;
  gap: 2px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-card);
  flex-shrink: 0;
`;

const Tab = styled.button<{ $active: boolean }>`
  appearance: none;
  background: transparent;
  border: 0;
  border-bottom: 2px solid ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  cursor: pointer;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-sans);
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-muted)')};
  display: inline-flex;
  align-items: center;
  gap: 5px;

  &:hover {
    color: var(--text-primary);
  }
`;

const TabCount = styled.span`
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  background: var(--pill-mono-bg);
  border-radius: var(--radius-full);
  padding: 0 5px;
`;

const TabBody = styled.div`
  padding: 8px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const CLAMP_AT = 110;

interface DetailPanelProps {
  cube: CatalogCube;
  onClose: () => void;
  /**
   * Pre-computed cluster key from the graph node (prefix-aware). When omitted
   * (grid view) the cluster is derived locally — correct on bare-name
   * workspaces, best-effort on prefixed ones.
   */
  cluster?: string;
}

type StructureTab = 'joins' | 'preaggs';

export function DetailPanel({ cube, onClose, cluster }: DetailPanelProps) {
  const [tab, setTab] = useState<MemberTab>('dimensions');
  const [descOpen, setDescOpen] = useState(false);

  const joins = cube.joins ?? [];
  const preAggs = cube.preAggregations ?? [];
  const hasStructure = joins.length > 0 || preAggs.length > 0;
  // Default the structure segment to whichever side has rows (joins first).
  const [structTab, setStructTab] = useState<StructureTab>(
    joins.length > 0 ? 'joins' : 'preaggs',
  );

  // The drawer accent matches the cube's graph cluster color so the panel and
  // the node read as the same object. Joins are needed for the cluster heuristic.
  const resolvedCluster =
    cluster ?? clusterOf(cube.name, (cube.joins ?? []).map((j) => j.name));
  const accent = clusterAccent(resolvedCluster);

  const tabs: Array<{ key: MemberTab; label: string; count: number }> = [
    { key: 'dimensions', label: 'Dimensions', count: cube.dimensions.length },
    { key: 'measures', label: 'Measures', count: cube.measures.length },
    { key: 'segments', label: 'Segments', count: cube.segments?.length ?? 0 },
  ];

  const desc = cube.description ?? '';
  const clamp = desc.length > CLAMP_AT && !descOpen;

  return (
    <Panel role="dialog" aria-label={`${cube.name} details`}>
      <AccentBar $accent={accent} aria-hidden="true" />
      <Header>
        <TitleRow>
          <Title>{cube.name}</Title>
          <TypeChip>{cube.type === 'view' ? 'view' : 'cube'}</TypeChip>
          <ClusterChip $accent={accent}>{clusterShortLabel(resolvedCluster)}</ClusterChip>
        </TitleRow>
        <CloseBtn type="button" aria-label="Close details" onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </CloseBtn>
        {desc && (
          <>
            <Description $clamp={clamp}>{desc}</Description>
            {desc.length > CLAMP_AT && (
              <MoreToggle type="button" onClick={() => setDescOpen((o) => !o)}>
                {descOpen ? '▲ less' : '… more'}
              </MoreToggle>
            )}
          </>
        )}
      </Header>

      {hasStructure && (
        <>
          <SegRow role="tablist" aria-label="Cube structure">
            <SegBtn
              type="button"
              role="tab"
              aria-selected={structTab === 'joins'}
              $active={structTab === 'joins'}
              disabled={joins.length === 0}
              onClick={() => setStructTab('joins')}
            >
              Joins <SegCount>{joins.length}</SegCount>
            </SegBtn>
            <SegBtn
              type="button"
              role="tab"
              aria-selected={structTab === 'preaggs'}
              $active={structTab === 'preaggs'}
              disabled={preAggs.length === 0}
              onClick={() => setStructTab('preaggs')}
            >
              Pre-aggs <SegCount>{preAggs.length}</SegCount>
            </SegBtn>
          </SegRow>
          <StructureBody role="tabpanel">
            {structTab === 'joins'
              ? joins.map((j) => {
                  const targetAccent = clusterAccent(clusterOf(j.name, []));
                  const keyLabel = parseKeyLabel(j.sql, cube.name, j.name);
                  return (
                    <JoinRow key={j.name}>
                      <JoinHead>
                        <JoinTarget style={{ color: targetAccent }}>{j.name}</JoinTarget>
                        {j.relationship && <JoinRel>· {j.relationship}</JoinRel>}
                      </JoinHead>
                      {keyLabel && <JoinKey>{keyLabel}</JoinKey>}
                    </JoinRow>
                  );
                })
              : preAggs.map((pa) => (
                  <JoinRow key={pa.name}>
                    <JoinHead>
                      <JoinTarget>{pa.name}</JoinTarget>
                      {pa.granularity && <JoinRel>· {pa.granularity}</JoinRel>}
                    </JoinHead>
                  </JoinRow>
                ))}
          </StructureBody>
        </>
      )}

      <TabBar role="tablist">
        {tabs.map((t) => (
          <Tab
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            $active={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <TabCount>{t.count}</TabCount>
          </Tab>
        ))}
      </TabBar>
      <TabBody role="tabpanel">
        <DetailPanelMembers cube={cube} tab={tab} />
      </TabBody>
    </Panel>
  );
}
