/**
 * ShareSegmentControl — owner sees the Share/Unshare toggle wired to the
 * segments client; non-owner sees only the "Shared by {owner}" chip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// Real i18n init so t() interpolates {{owner}} (same pattern as user-menu test).
import '../../../../../i18n';
import type { Segment } from '../../../../../types/segment-api';
import { segmentsClient } from '../../../../../api/segments-client';

vi.mock('../../../../../api/segments-client', () => ({
  segmentsClient: { share: vi.fn(), unshare: vi.fn() },
}));
vi.mock('../../../use-segment-ids', () => ({
  invalidateSegmentIds: vi.fn(),
}));

import { ShareSegmentControl } from '../share-segment-control';

function seg(over: Partial<Segment>): Segment {
  return {
    id: 'seg1',
    name: 'Test',
    type: 'manual',
    owner: 'alice-sub',
    status: 'fresh',
    cube: null,
    predicate_tree: null,
    cube_query_json: null,
    sql_preview: null,
    uid_count: 0,
    uid_list: [],
    tags: [],
    refresh_cadence_min: null,
    last_refreshed_at: null,
    broken_reason: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    game_id: 'ptg',
    activations: [],
    funnel_json: null,
    visibility: 'personal',
    owner_label: 'alice',
    shared_at: null,
    is_owner: true,
    can_administer: true,
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(segmentsClient.share).mockReset();
  vi.mocked(segmentsClient.unshare).mockReset();
});

describe('ShareSegmentControl', () => {
  it('owner of a personal segment sees Share; click calls share() and propagates the row', async () => {
    const updated = seg({ visibility: 'shared', shared_at: '2026-06-07T00:00:00Z' });
    vi.mocked(segmentsClient.share).mockResolvedValue(updated);
    const onChange = vi.fn();

    render(<ShareSegmentControl segment={seg({})} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Share|segments\.detail\.share\.share/ }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    expect(segmentsClient.share).toHaveBeenCalledWith('seg1');
    expect(segmentsClient.unshare).not.toHaveBeenCalled();
  });

  it('owner of a shared segment sees Unshare; click calls unshare()', async () => {
    const updated = seg({});
    vi.mocked(segmentsClient.unshare).mockResolvedValue(updated);
    const onChange = vi.fn();

    render(
      <ShareSegmentControl
        segment={seg({ visibility: 'shared', shared_at: '2026-06-07T00:00:00Z' })}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Unshare|segments\.detail\.share\.unshare/ }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    expect(segmentsClient.unshare).toHaveBeenCalledWith('seg1');
  });

  it('non-owner non-admin sees the shared-by chip and no toggle button', () => {
    render(
      <ShareSegmentControl
        segment={seg({ visibility: 'shared', is_owner: false, can_administer: false, owner_label: 'alice' })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/alice/)).toBeTruthy();
  });

  it('admin viewer (can_administer without ownership) gets the toggle, not the chip', () => {
    render(
      <ShareSegmentControl
        segment={seg({ visibility: 'shared', is_owner: false, can_administer: true, owner_label: 'alice' })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('non-admin chip degrades to the owner sub when owner_label is NULL (legacy rows)', () => {
    render(
      <ShareSegmentControl
        segment={seg({ visibility: 'shared', is_owner: false, can_administer: false, owner_label: null })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/alice-sub/)).toBeTruthy();
  });
});
