/**
 * SavedViewsPage — list saved views from localStorage. v1 surface only; the
 * "Save view" action from QueryBuilder lands in a later cook.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { useSavedViews } from '../../../shared/user-prefs/use-saved-views';

const Page = styled.div`
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Item = styled.li`
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--border-card);
  border-radius: 8px;
  padding: 10px 14px;
  background: var(--bg-card);

  a {
    color: var(--brand);
    text-decoration: none;
    font-weight: 500;
  }
`;

const Btn = styled.button`
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--border-card);
  color: var(--text-muted);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
`;

const Empty = styled.div`
  padding: 28px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

export function SavedViewsPage() {
  const { views, remove } = useSavedViews();
  return (
    <Page>
      <Title>Saved views</Title>
      <Hint>Quick links you've pinned. Saved from metric pages or Explore.</Hint>
      {views.length === 0 ? (
        <Empty>No saved views yet.</Empty>
      ) : (
        <List>
          {views.map((v) => (
            <Item key={v.id}>
              <Link to={v.routeTo}>{v.label}</Link>
              <span style={{ fontSize: 11, color: '#737373' }}>
                {new Date(v.createdAt).toLocaleDateString()}
              </span>
              <Btn onClick={() => remove(v.id)}>Remove</Btn>
            </Item>
          ))}
        </List>
      )}
    </Page>
  );
}
