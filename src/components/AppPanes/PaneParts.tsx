import styled from 'styled-components';

// Shared rounded white card. Used by panes' inner sections (RunBand, PillBar, Filters).
export const Card = styled.section`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
  font-family: var(--font-sans);
`;

export const PaneHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-card);
  flex-shrink: 0;
`;

export const PaneTitle = styled.h2`
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
`;

export const PaneBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
`;

export const SectionLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 8px 4px 6px;
`;
