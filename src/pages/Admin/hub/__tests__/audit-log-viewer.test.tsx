/**
 * AuditLogViewer — renders audit rows from GET /api/admin/audit, filters, and
 * exports CSV with a self-audit `export` event.
 *
 * NOTE: user-event is NOT installed; uses fireEvent.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApiFetch = vi.fn();
vi.mock('../../../../api/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockRecordExport = vi.fn();
vi.mock('../../../../api/feature-open-beacon', () => ({
  recordExport: (...args: unknown[]) => mockRecordExport(...args),
}));

import { AuditLogViewer } from '../audit-log-viewer';

const ENTRIES = [
  { id: 2, actorEmail: 'admin@corp.com', action: 'set_games', targetEmail: 'bob@corp.com', detail: { games: ['muaw'] }, ts: '2026-06-02T10:00:00.000Z' },
  { id: 1, actorEmail: 'admin@corp.com', action: 'set_role', targetEmail: 'bob@corp.com', detail: { role: 'editor' }, ts: '2026-06-01T10:00:00.000Z' },
];

describe('AuditLogViewer', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockRecordExport.mockReset();
    mockApiFetch.mockResolvedValue({ entries: ENTRIES });
    // jsdom lacks URL.createObjectURL — stub the download plumbing.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('renders audit rows from the API', async () => {
    render(<AuditLogViewer />);
    expect(await screen.findByText('set_games')).toBeDefined();
    expect(await screen.findByText('set_role')).toBeDefined();
  });

  it('hits /api/admin/audit with filter querystring when a filter is typed', async () => {
    render(<AuditLogViewer />);
    await screen.findByText('set_games');
    fireEvent.change(screen.getByLabelText(/filter by action/i), { target: { value: 'set_role' } });
    await waitFor(() => {
      const urls = mockApiFetch.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes('action=set_role'))).toBe(true);
    });
  });

  it('exporting emits a self-audit export event', async () => {
    render(<AuditLogViewer />);
    await screen.findByText('set_games');
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    expect(mockRecordExport).toHaveBeenCalledWith('audit_log');
  });

  it('shows an empty state when no entries match', async () => {
    mockApiFetch.mockResolvedValue({ entries: [] });
    render(<AuditLogViewer />);
    expect(await screen.findByText(/no audit entries match/i)).toBeDefined();
  });
});
