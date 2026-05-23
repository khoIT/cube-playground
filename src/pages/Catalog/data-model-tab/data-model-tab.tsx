import { Link } from 'react-router-dom';
import styled from 'styled-components';

const Wrap = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
`;

const Card = styled.div`
  max-width: 480px;
  text-align: center;
  padding: 32px 28px;
  border: 1px dashed var(--border-card);
  border-radius: 12px;
  background: var(--bg-card);
`;

const Title = styled.h2`
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
`;

const Body = styled.p`
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
`;

const Actions = styled.div`
  display: flex;
  gap: 12px;
  justify-content: center;
  font-size: 13px;

  a {
    color: var(--brand);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
`;

export function DataModelTab() {
  return (
    <Wrap>
      <Card>
        <Title>Data Model — coming in Phase 5</Title>
        <Body>
          Concept-first cards for measures, dimensions, and segments will live
          here. For now, the cube-grouped browser is one tab over.
        </Body>
        <Actions>
          <Link to="/catalog/cubes">Browse Cubes →</Link>
          <Link to="/catalog/models">Browse Models →</Link>
        </Actions>
      </Card>
    </Wrap>
  );
}
