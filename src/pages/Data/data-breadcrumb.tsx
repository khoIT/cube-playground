/**
 * Shared breadcrumb for the Data hub's navigation depths
 * (Connectors › Connector › Triage). Crumbs with an onClick render as links;
 * the trailing crumb (or any without onClick) renders as the current location.
 * Keeps navigation affordances identical across connector-detail and the triage
 * canvas so users can always back out a level. Tokens-only per design guidelines.
 */
import { ReactElement, Fragment } from 'react';
import styled from 'styled-components';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  onClick?: () => void;
}

const Nav = styled.nav`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 12.5px;
  color: var(--text-muted);
`;
const Link = styled.button`
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--text-muted);
  cursor: pointer;
  &:hover {
    color: var(--brand);
    text-decoration: underline;
  }
`;
const Current = styled.span`
  font-weight: 600;
  color: var(--text-secondary);
`;

export function DataBreadcrumb({ items }: { items: Crumb[] }): ReactElement {
  return (
    <Nav aria-label="Breadcrumb">
      {items.map((c, i) => {
        const isLast = i === items.length - 1;
        return (
          <Fragment key={`${c.label}-${i}`}>
            {c.onClick && !isLast ? (
              <Link type="button" onClick={c.onClick}>{c.label}</Link>
            ) : (
              <Current>{c.label}</Current>
            )}
            {!isLast ? <ChevronRight size={13} aria-hidden /> : null}
          </Fragment>
        );
      })}
    </Nav>
  );
}
