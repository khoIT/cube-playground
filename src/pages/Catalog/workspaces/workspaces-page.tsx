/**
 * WorkspacesPage — light shell only. Full canvas (dashboards / pinned
 * metrics) is deferred per the brainstorm; this surface is here so the
 * route exists and the long-tail digest links resolve.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

const Page = styled.div`
  padding: 28px 32px;
`;

const Card = styled.div`
  border: 1px dashed var(--border-card, #e5e5e5);
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  color: var(--text-muted, #737373);

  a {
    color: var(--brand, #f05a22);
    text-decoration: none;
  }
`;

export function WorkspacesPage() {
  return (
    <Page>
      <Card>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--text-primary, #171717)' }}>
          Workspaces — coming soon
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 13 }}>
          Pinned metric canvases will live here. Until then, use{' '}
          <Link to="/catalog/saved-views">Saved Views</Link> for quick links.
        </p>
      </Card>
    </Page>
  );
}
