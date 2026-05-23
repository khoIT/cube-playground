import styled from 'styled-components';

const Wrap = styled.section`
  padding: 40px 24px;
  text-align: center;
  color: var(--text-muted, #737373);
  font-size: 13px;
`;

export function TabActivity() {
  return <Wrap>Activity log — coming in Phase 9 (audit + edit history).</Wrap>;
}
