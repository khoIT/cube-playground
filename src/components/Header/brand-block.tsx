import { Link } from 'react-router-dom';
import styled from 'styled-components';

const Wrap = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: var(--text-primary);
  margin-right: 24px;

  &:hover,
  &:focus {
    color: var(--text-primary);
  }
`;

const BrandMark = styled.span`
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 18px;
  letter-spacing: -0.2px;
  color: var(--text-primary);
`;

const Divider = styled.span`
  width: 1px;
  height: 18px;
  background-color: var(--border-strong);
`;

const Group = styled.span`
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 14px;
  color: var(--text-secondary);
  letter-spacing: 0.2px;
`;

const Badge = styled.span`
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background-color: var(--bg-muted);
  color: var(--text-secondary);
  border: 1px solid var(--border-card);
  text-transform: none;
`;

export function BrandBlock() {
  return (
    <Wrap to="/build" aria-label="GDS Cube home">
      <BrandMark>Cube</BrandMark>
      <Divider />
      <Group>VNGGames</Group>
      <Badge>Data Platform</Badge>
    </Wrap>
  );
}
