/**
 * SegmentProposalCard — edit-mode rendering and confirm dispatch.
 *
 * The critical regression guard: an EDIT proposal (proposal.edit present) must
 * PATCH the existing segment via segmentsClient.update — never POST a new one
 * via create. Also asserts the edit-specific chrome (header, "Previously" diff,
 * "Update segment" button) and that a plain create proposal still POSTs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SegmentProposalPayload } from '../../../../api/segment-proposal';

const pushMock = vi.fn();
vi.mock('react-router-dom', () => ({ useHistory: () => ({ push: pushMock }) }));
vi.mock('antd', () => ({ message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const updateMock = vi.fn();
const createMock = vi.fn();
vi.mock('../../../../api/segments-client', () => ({
  segmentsClient: {
    update: (...a: unknown[]) => updateMock(...a),
    create: (...a: unknown[]) => createMock(...a),
    get: vi.fn(),
  },
}));
vi.mock('../../../../hooks/use-server-pref', () => ({
  useServerPref: () => [null, vi.fn(), vi.fn()],
}));
vi.mock('../../../Segments/use-segment-ids', () => ({ invalidateSegmentIds: vi.fn() }));

import { SegmentProposalCard } from '../segment-proposal-card';

const BASE: SegmentProposalPayload = {
  type: 'segment_proposal',
  name: 'Whales',
  game_id: 'cfm_vn',
  cube: 'mf_users',
  predicate_tree: {
    kind: 'group',
    id: 'g',
    op: 'AND',
    children: [
      { kind: 'leaf', id: 'a', member: 'mf_users.ltv_vnd', type: 'number', op: 'gte', values: [1_000_000] },
      { kind: 'leaf', id: 'b', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
    ],
  },
  resolved: { estCount: 4321, population: 'edited "Whales"' },
  disclosures: ['Adding: mf_users.country = VN'],
  suggestedVisibility: 'personal',
};

const EDIT: SegmentProposalPayload = {
  ...BASE,
  edit: {
    segment_id: 'seg-1',
    previous_predicate_tree: {
      kind: 'group', id: 'g0', op: 'AND',
      children: [{ kind: 'leaf', id: 'a', member: 'mf_users.ltv_vnd', type: 'number', op: 'gte', values: [1_000_000] }],
    },
  },
};

beforeEach(() => {
  pushMock.mockReset();
  updateMock.mockReset();
  createMock.mockReset();
});

describe('SegmentProposalCard (edit mode)', () => {
  it('renders edit chrome: header, Previously diff, Update button', () => {
    render(<SegmentProposalCard proposal={EDIT} />);
    expect(screen.getByText('Segment edit')).toBeTruthy();
    expect(screen.getByText('Previously')).toBeTruthy();
    expect(screen.getByText('Update segment')).toBeTruthy();
    // The create-only "Open in editor" affordance is hidden for edits.
    expect(screen.queryByText('Open in editor')).toBeNull();
  });

  it('confirm PATCHes via update, not create', async () => {
    updateMock.mockResolvedValueOnce({ id: 'seg-1', name: 'Whales', status: 'refreshing', uid_count: 4321, visibility: 'personal', game_id: 'cfm_vn' });
    render(<SegmentProposalCard proposal={EDIT} />);
    fireEvent.click(screen.getByText('Update segment'));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(createMock).not.toHaveBeenCalled();
    // Patches the right segment with the new predicate tree.
    expect(updateMock.mock.calls[0][0]).toBe('seg-1');
    expect(updateMock.mock.calls[0][1]).toMatchObject({ predicate_tree: EDIT.predicate_tree });
  });

  it('a plain create proposal still POSTs via create', async () => {
    createMock.mockResolvedValueOnce({ id: 'new-1', name: 'Whales', status: 'refreshing', uid_count: 100, visibility: 'personal', game_id: 'cfm_vn' });
    render(<SegmentProposalCard proposal={BASE} />);
    expect(screen.getByText('Segment proposal')).toBeTruthy();
    fireEvent.click(screen.getByText('Create segment'));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(updateMock).not.toHaveBeenCalled();
  });
});
