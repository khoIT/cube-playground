/**
 * WhatsNewBell — the merged topbar bell badges the unread announcement count and
 * exposes an accessible label. Read-state client mocked for determinism.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../api/announcements-client', () => ({
  listReadAnnouncementIds: vi.fn().mockResolvedValue([]),
  markAnnouncementsRead: vi.fn().mockResolvedValue([]),
}));

import { WhatsNewBell } from '../whats-new-bell';
import { announcementIds } from '../announcements-content';

describe('WhatsNewBell', () => {
  it('shows the unread badge once read-state loads', async () => {
    render(
      <MemoryRouter>
        <WhatsNewBell />
      </MemoryRouter>,
    );
    // Nothing read → every bundled entry is unread.
    await waitFor(() =>
      expect(screen.getByLabelText(`What's New — ${announcementIds.length} unread`)).toBeTruthy(),
    );
    expect(screen.getByText(String(announcementIds.length))).toBeTruthy();
  });
});
