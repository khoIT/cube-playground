/**
 * SidebarEdgeToggle — the flush seam toggle. Verifies the aria-label + chevron
 * direction flip with collapse state, and that a click toggles via the store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setCollapsedMock = vi.fn();
vi.mock('../sidebar-collapsed-store', () => ({
  setCollapsed: (v: boolean) => setCollapsedMock(v),
}));

import { SidebarEdgeToggle } from '../sidebar-edge-toggle';

describe('SidebarEdgeToggle', () => {
  beforeEach(() => setCollapsedMock.mockClear());

  it('labels "Collapse sidebar" and shows a left chevron when expanded', () => {
    const { container } = render(<SidebarEdgeToggle collapsed={false} />);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    expect(container.querySelector('.lucide-chevron-left')).toBeTruthy();
    expect(container.querySelector('.lucide-chevron-right')).toBeNull();
  });

  it('labels "Expand sidebar" and shows a right chevron when collapsed', () => {
    const { container } = render(<SidebarEdgeToggle collapsed />);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    expect(container.querySelector('.lucide-chevron-right')).toBeTruthy();
    expect(container.querySelector('.lucide-chevron-left')).toBeNull();
  });

  it('toggles to collapsed on click when expanded', () => {
    render(<SidebarEdgeToggle collapsed={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(setCollapsedMock).toHaveBeenCalledWith(true);
  });

  it('toggles to expanded on click when collapsed', () => {
    render(<SidebarEdgeToggle collapsed />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(setCollapsedMock).toHaveBeenCalledWith(false);
  });
});
