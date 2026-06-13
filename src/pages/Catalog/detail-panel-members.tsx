/**
 * DetailPanelMembers — the active tab body of `<DetailPanel>`: the cube's
 * dimensions, measures, or segments. Every row is a navigation target into the
 * catalog so the graph/grid drawer is a launch pad, not a dead end:
 *   - measures   → the per-measure metric card (`/metric/:cube/:member`)
 *   - dimensions → the concept page (`/catalog/concept/dimension/:fqn`)
 *   - segments   → the concept page (`/catalog/concept/segment/:fqn`)
 *
 * Primary-key and private dimensions have no concept page (they're excluded
 * from the concept index), so those render as non-clickable display rows with
 * their markers — never a dead link.
 */
import { KeyboardEvent } from 'react';
import styled from 'styled-components';
import { useHistory } from 'react-router-dom';

import type { CatalogCube } from './use-catalog-meta';
import { MeasureRow } from './measure-row';
import { buildMetricUrl } from './try-it-url';
import { resolveMemberNames } from './data-model-tab/use-concepts';

export type MemberTab = 'dimensions' | 'measures' | 'segments';

const Row = styled.div<{ $clickable: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 3px 0;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  user-select: none;
  outline: none;
  &:hover code {
    color: ${(p) => (p.$clickable ? 'var(--brand)' : 'var(--text-primary)')};
  }
  &:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: 2px;
  }
`;

const Code = styled.code`
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-primary);
`;

const Chip = styled.span`
  display: inline-flex;
  padding: 1px 6px;
  border-radius: var(--pill-mono-radius);
  background: var(--pill-mono-bg);
  font-size: 10.5px;
  color: var(--text-secondary);
  margin-left: 6px;
`;

const Empty = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px 0;
`;

interface ConceptRowProps {
  label: string;
  href: string | null;
  chips: React.ReactNode;
}

function ConceptRow({ label, href, chips }: ConceptRowProps) {
  const history = useHistory();
  const clickable = href != null;
  const go = () => {
    if (href) history.push(href);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (clickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      go();
    }
  };
  return (
    <Row
      $clickable={clickable}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? go : undefined}
      onKeyDown={onKey}
    >
      <span>
        <Code>{label}</Code>
        {chips}
      </span>
    </Row>
  );
}

function conceptHref(type: 'dimension' | 'segment', cubeName: string, member: string): string {
  const { fqn } = resolveMemberNames(cubeName, member);
  return `/catalog/concept/${type}/${encodeURIComponent(fqn)}`;
}

interface DetailPanelMembersProps {
  cube: CatalogCube;
  tab: MemberTab;
}

export function DetailPanelMembers({ cube, tab }: DetailPanelMembersProps) {
  const history = useHistory();

  if (tab === 'measures') {
    if (cube.measures.length === 0) return <Empty>No measures</Empty>;
    return (
      <>
        {cube.measures.map((m) => (
          <MeasureRow
            key={m.name}
            measure={m}
            cube={cube}
            onClick={() => history.push(buildMetricUrl(m.name))}
          />
        ))}
      </>
    );
  }

  if (tab === 'segments') {
    const segments = cube.segments ?? [];
    if (segments.length === 0) return <Empty>No segments</Empty>;
    return (
      <>
        {segments.map((s) => {
          const short = s.name.split('.').slice(1).join('.') || s.name;
          return (
            <ConceptRow
              key={s.name}
              label={short}
              href={conceptHref('segment', cube.name, s.name)}
              chips={null}
            />
          );
        })}
      </>
    );
  }

  // dimensions
  if (cube.dimensions.length === 0) return <Empty>No dimensions</Empty>;
  return (
    <>
      {cube.dimensions.map((d) => {
        const short = d.name.split('.').slice(1).join('.') || d.name;
        const isPrivate = d.public === false;
        // PK + private dims aren't in the concept index → no link, just display.
        const linkable = !isPrivate && !d.primaryKey;
        return (
          <ConceptRow
            key={d.name}
            label={short}
            href={linkable ? conceptHref('dimension', cube.name, d.name) : null}
            chips={
              <>
                {d.type && <Chip>{d.type}</Chip>}
                {d.primaryKey && <Chip>PK</Chip>}
                {isPrivate && <Chip>hidden</Chip>}
              </>
            }
          />
        );
      })}
    </>
  );
}
