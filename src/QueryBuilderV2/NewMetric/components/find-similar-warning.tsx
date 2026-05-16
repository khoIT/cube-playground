import { useState } from 'react';
import styled from 'styled-components';
import { SimilarMeasure } from '../hooks/use-find-similar';

const MAX_SHOWN = 5;

const Card = styled.div`
  border: 1px solid var(--warning);
  background: rgba(245, 158, 11, 0.08);
  border-radius: var(--radius-card);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Header = styled.button`
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: #92400e;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Item = styled.li`
  font-size: 12.5px;
  color: var(--text-secondary);
  padding: 6px 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ItemName = styled.span`
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-primary);
`;

const ItemTitle = styled.span`
  color: var(--text-muted);
  font-size: 11.5px;
`;

const MoreHint = styled.div`
  font-size: 11.5px;
  color: var(--text-muted);
`;

interface FindSimilarWarningProps {
  matches: SimilarMeasure[];
}

/**
 * Collapsible warning that flags existing measures matching the wizard's
 * (sourceCube, aggType) tuple. Loose match — `measure.sql` is security-stripped
 * by Cube, so exact column-overlap detection isn't possible.
 *
 * Renders nothing when there are no matches.
 */
export function FindSimilarWarning({ matches }: FindSimilarWarningProps) {
  const [expanded, setExpanded] = useState(true);
  if (matches.length === 0) return null;

  const shown = matches.slice(0, MAX_SHOWN);
  const overflow = matches.length - shown.length;

  return (
    <Card role="alert">
      <Header
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span>
          {matches.length} similar measure{matches.length > 1 ? 's' : ''} on this cube
        </span>
        <span aria-hidden>{expanded ? '−' : '+'}</span>
      </Header>

      {expanded && (
        <>
          <List>
            {shown.map((m) => (
              <Item key={m.name}>
                <ItemName>{m.name}</ItemName>
                <ItemTitle>{m.title}</ItemTitle>
              </Item>
            ))}
          </List>
          {overflow > 0 && <MoreHint>+ {overflow} more…</MoreHint>}
        </>
      )}
    </Card>
  );
}
