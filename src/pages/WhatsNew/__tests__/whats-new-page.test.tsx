/**
 * WhatsNewPage — renders bundled release entries as a timeline, shows the unread
 * count, and "Mark all read" persists every id through the client.
 *
 * The read-state client is mocked so the test is deterministic regardless of any
 * running server; content comes from the real bundled markdown via Vite glob.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const markSpy = vi.fn().mockResolvedValue([]);
vi.mock('../../../api/announcements-client', () => ({
  listReadAnnouncementIds: vi.fn().mockResolvedValue([]),
  markAnnouncementsRead: (...args: unknown[]) => markSpy(...args),
}));

import { WhatsNewPage } from '../index';
import { announcementIds } from '../announcements-content';

function renderPage() {
  return render(
    <MemoryRouter>
      <WhatsNewPage />
    </MemoryRouter>,
  );
}

describe('WhatsNewPage', () => {
  beforeEach(() => markSpy.mockClear());

  it('renders the seeded releases and the unread count, then marks all read', async () => {
    renderPage();

    // A known seed title renders (content is real bundled markdown).
    expect(await screen.findByText('Lakehouse Snapshot Inbox')).toBeTruthy();

    // Unread count reflects "nothing read yet" = every bundled entry.
    await waitFor(() => expect(screen.getByText(`${announcementIds.length} unread`)).toBeTruthy());

    fireEvent.click(screen.getByText('Mark all read'));

    // Persists every id; with nothing unread the "Mark all read" affordance and
    // the unread chip both disappear.
    expect(markSpy).toHaveBeenCalledTimes(1);
    expect((markSpy.mock.calls[0][0] as string[]).sort()).toEqual([...announcementIds].sort());
    await waitFor(() => expect(screen.queryByText('Mark all read')).toBeNull());
    expect(screen.queryByText(`${announcementIds.length} unread`)).toBeNull();
  });
});
