/**
 * SegmentedControl — the Layer-2 view selector shared across the right pane.
 *
 * Single source of truth for the brand-filled segmented control so the Chart
 * view-type toggle (Line/Bar/Area/Table) and the Analysis mode picker
 * (Breakdown/Distribution/Funnel) stay visually identical. The active segment
 * is a solid brand fill; the group renders as a white card meant to sit inside
 * a recessed (--bg-muted) track, so the two selection layers (mode vs. view)
 * never compete on color — outer layer carries elevation, inner carries hue.
 *
 * Height is 30px to line up with the ui-kit `size="small"` action buttons
 * (Pivot/Code/Pin) sharing the toolbar row.
 */

import styled from 'styled-components';

export const SegmentGroup = styled.div<{ $fill?: boolean }>`
  display: ${(p) => (p.$fill ? 'flex' : 'inline-flex')};
  ${(p) => (p.$fill ? 'flex: 1 1 auto;' : '')}
  min-width: 0;
  padding: 2px;
  gap: 2px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
`;

export const SegmentButton = styled.button<{ $active: boolean; $fill?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  ${(p) => (p.$fill ? 'flex: 1 1 0;' : '')}
  min-width: 0;
  gap: 5px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 11.5px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  white-space: nowrap;

  &:hover {
    background: ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
    color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-primary)')};
  }

  /* Label span only — :not(.anticon) leaves the AntD icon wrapper untouched. */
  & > span:not(.anticon) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;
