/**
 * Tests for PendingApprovalQueue — the promoted approve/deny card.
 *
 * Approve must issue ONE PATCH setting status=active + the selected role; Deny
 * sets status=disabled. The card hides itself when the queue is empty.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PendingApprovalQueue } from '../pending-approval-queue';

const mockPatch = vi.fn();
vi.mock('../../access/use-admin-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../access/use-admin-access')>();
  return { ...actual, patchAdminUser: (...args: unknown[]) => mockPatch(...args) };
});

const PENDING = [
  { email: 'new1@corp.com', lastLogin: '2026-06-01T10:00:00Z' },
  { email: 'new2@corp.com', lastLogin: null },
];

describe('PendingApprovalQueue', () => {
  beforeEach(() => { mockPatch.mockReset(); mockPatch.mockResolvedValue(undefined); });

  it('renders nothing when the queue is empty', () => {
    const { container } = render(<PendingApprovalQueue users={[]} onChanged={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the count badge and a row per pending user', () => {
    render(<PendingApprovalQueue users={PENDING} onChanged={vi.fn()} />);
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('new1@corp.com')).toBeDefined();
    expect(screen.getByText('new2@corp.com')).toBeDefined();
  });

  it('Approve issues one PATCH with status=active + selected role, then calls onChanged', async () => {
    const onChanged = vi.fn();
    render(<PendingApprovalQueue users={[PENDING[0]]} onChanged={onChanged} />);

    // Choose editor before approving.
    fireEvent.change(screen.getByLabelText(/Role for new1@corp.com/i), { target: { value: 'editor' } });
    fireEvent.click(screen.getByText(/^Approve$/i));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith('new1@corp.com', { status: 'active', role: 'editor' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('Deny issues a PATCH with status=disabled', async () => {
    const onChanged = vi.fn();
    render(<PendingApprovalQueue users={[PENDING[0]]} onChanged={onChanged} />);
    fireEvent.click(screen.getByText(/^Deny$/i));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('new1@corp.com', { status: 'disabled' }));
  });

  it('defaults the role to viewer', async () => {
    render(<PendingApprovalQueue users={[PENDING[0]]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText(/^Approve$/i));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('new1@corp.com', { status: 'active', role: 'viewer' }));
  });
});
