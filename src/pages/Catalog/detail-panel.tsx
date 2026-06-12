/**
 * DetailPanel — the cube drawer shown beside the join graph and the card grid.
 * Mirrors the standalone model-viewer drawer: header + (clamped) description,
 * a Joins section with the colored target / relationship / key mapping, then a
 * Dimensions / Measures / Segments tab bar whose rows link into the catalog.
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
import { clusterAccent } from './cube-graph/cube-clusters';
import { clusterOf, parseKeyLabel } from './cube-graph/build-join-graph';

const Panel = styled.aside`
  width: 480px;
  flex-shrink: 0;
  background: var(--bg-card);
  border-left: 1px solid var(--border-card);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const Header = styled.header<{ $accent: string }>`
  padding: 18px 24px 14px;
  border-top: 4px solid ${(p) => p.$accent};
  border-bottom: 1px solid var(--border-card);
  position: relative;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-primary);
  word-break: break-all;
  padding-right: 28px;
`;

const SubLine = styled.div`
  margin-top: 4px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
`;

const CloseBtn = styled.button`
  position: absolute;
  top: 14px;
  right: 16px;
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
  margin: 10px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
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
  padding: 4px 0 0;
  cursor: pointer;
  font-size: 11.5px;
  color: var(--brand);

  &:hover {
    text-decoration: underline;
  }
`;

const Section = styled.section`
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const JoinRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
`;

const JoinHead = styled.div`
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
`;

const JoinTarget = styled.code`
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
`;

const JoinRel = styled.span`
  font-size: 10.5px;
  color: var(--text-muted);
`;

const JoinKey = styled.code`
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
`;

const TabBar = styled.div`
  display: flex;
  gap: 2px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-card);
`;

const Tab = styled.button<{ $active: boolean }>`
  appearance: none;
  background: transparent;
  border: 0;
  border-bottom: 2px solid ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  cursor: pointer;
  padding: 10px 12px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--font-sans);
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-muted)')};
  display: inline-flex;
  align-items: center;
  gap: 6px;

  &:hover {
    color: var(--text-primary);
  }
`;

const TabCount = styled.span`
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  background: var(--pill-mono-bg);
  border-radius: var(--radius-full);
  padding: 0 6px;
`;

const TabBody = styled.div`
  padding: 12px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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

export function DetailPanel({ cube, onClose, cluster }: DetailPanelProps) {
  const [tab, setTab] = useState<MemberTab>('dimensions');
  const [descOpen, setDescOpen] = useState(false);

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
      <Header $accent={accent}>
        <Title>{cube.name}</Title>
        <SubLine>{cube.type === 'view' ? 'view' : 'cube'}</SubLine>
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

      {cube.joins && cube.joins.length > 0 && (
        <Section>
          <SectionTitle>Joins ({cube.joins.length})</SectionTitle>
          {cube.joins.map((j) => {
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
          })}
        </Section>
      )}

      {cube.preAggregations && cube.preAggregations.length > 0 && (
        <Section>
          <SectionTitle>Pre-aggregations ({cube.preAggregations.length})</SectionTitle>
          {cube.preAggregations.map((pa) => (
            <JoinRow key={pa.name}>
              <JoinHead>
                <JoinTarget>{pa.name}</JoinTarget>
                {pa.granularity && <JoinRel>· {pa.granularity}</JoinRel>}
              </JoinHead>
            </JoinRow>
          ))}
        </Section>
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
