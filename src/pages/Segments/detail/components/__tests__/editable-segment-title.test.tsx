/**
 * EditableSegmentTitle — non-admins see a static title; owners/admins click to
 * rename, persisting via segmentsClient.update and handing the saved row back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// Real i18n init so t() resolves the defaultValue strings.
import '../../../../../i18n';
import type { Segment } from '../../../../../types/segment-api';
import { segmentsClient } from '../../../../../api/segments-client';

vi.mock('../../../../../api/segments-client', () => ({
  segmentsClient: { update: vi.fn() },
}));

import { EditableSegmentTitle } from '../editable-segment-title';

function seg(over: Partial<Segment> = {}): Segment {
  return {
    id: 'seg1',
    name: 'Whales',
    type: 'predicate',
    owner: 'alice-sub',
    can_administer: true,
    game_id: 'cfm_vn',
    ...over,
  } as unknown as Segment;
}

beforeEach(() => {
  vi.mocked(segmentsClient.update).mockReset();
});

describe('<EditableSegmentTitle />', () => {
  it('renders a plain heading (no edit affordance) for non-administrators', () => {
    render(<EditableSegmentTitle segment={seg({ can_administer: false })} onRename={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Whales' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renames via the client and reports the saved segment back', async () => {
    const saved = seg({ name: 'High rollers' });
    vi.mocked(segmentsClient.update).mockResolvedValue(saved);
    const onRename = vi.fn();
    render(<EditableSegmentTitle segment={seg()} onRename={onRename} />);

    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByLabelText('Segment name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'High rollers' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(segmentsClient.update).toHaveBeenCalledWith('seg1', { name: 'High rollers' }));
    expect(onRename).toHaveBeenCalledWith(saved);
  });

  it('does not call the client when the name is unchanged or blank', async () => {
    render(<EditableSegmentTitle segment={seg()} onRename={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByLabelText('Segment name') as HTMLInputElement;
    // Blank → cancel.
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(segmentsClient.update).not.toHaveBeenCalled();
  });

  it('cancels on Escape without persisting', () => {
    render(<EditableSegmentTitle segment={seg()} onRename={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByLabelText('Segment name');
    fireEvent.change(input, { target: { value: 'Throwaway' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(segmentsClient.update).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Whales' })).toBeTruthy();
  });
});
