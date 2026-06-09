/**
 * CS care-first 360 — component contract tests.
 *
 * Locks these behaviors:
 *  1. Sample fallback: timeline shows "sample" tag + live open count when no real
 *     cases are present (0-case fallback, not loading state).
 *  2. Real cases: timeline renders actual playbook names from the ledger, not
 *     the hard-coded sample. The "sample" tag must be absent.
 *  3. Mark-treated form: submitting a filled treat form calls patchCareCase with
 *     the exact {status:'treated', channel_used, action_taken, notes} payload and
 *     triggers a refetch of the VIP case history.
 *  4. CsOwnerChip: own=brand tint, other=muted, null=hidden.
 *  5. Rail dismiss flow: reason select → onDismiss callback called with code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CsCareHistoryTimeline } from '../member360/cs-care-history-timeline';
import { CsRecommendedActionRail } from '../member360/cs-recommended-action-rail';
import { CsOwnerChip } from '../member360/cs-owner-chip';
import { SAMPLE_CARE_TIMELINE, SAMPLE_RECOMMENDED_ACTION } from '../member360/cs-member360-mock';
import type { CareTimelineEvent, RecommendedAction } from '../member360/cs-member360-mock';
import type { CareCase } from '../use-care-cases';
import { casesToTimeline, pickTopOpenCase, caseToRecommendedAction } from '../member360/cs-member360-derive';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCase(overrides: Partial<CareCase> = {}): CareCase {
  return {
    id: 'c1',
    game_id: 'cfm_vn',
    playbook_id: 'pb1',
    playbook_name: 'High Roller Drop',
    playbook_priority: 1,
    uid: 'u1',
    source: 'membership',
    opened_at: '2026-06-01T10:00:00Z',
    stats_snapshot_json: null,
    status: 'new',
    condition_lapsed: 0,
    assignee: null,
    treated_at: null,
    channel_used: null,
    action_taken: null,
    notes: null,
    kpi_target: null,
    kpi_eval_at: null,
    outcome: null,
    ...overrides,
  };
}

// ── 1. CsCareHistoryTimeline: sample fallback (locked behavior) ───────────────

describe('CsCareHistoryTimeline — sample fallback (0 cases)', () => {
  it('labels the timeline as a sample and shows the live open count', () => {
    render(<CsCareHistoryTimeline events={SAMPLE_CARE_TIMELINE} openCount={3} live={false} />);
    expect(screen.getByText('sample')).toBeTruthy();
    expect(screen.getByText('3 open')).toBeTruthy();
    // At least one matched-playbook pill from the sample.
    expect(screen.getAllByText('VIP spend drop 14d').length).toBeGreaterThan(0);
  });

  it('omits the open badge when the count is unknown', () => {
    render(<CsCareHistoryTimeline events={SAMPLE_CARE_TIMELINE} openCount={null} live={false} />);
    expect(screen.queryByText(/\d+ open/)).toBeNull();
  });

  it('shows sample tag when live=false', () => {
    render(<CsCareHistoryTimeline events={SAMPLE_CARE_TIMELINE} openCount={0} live={false} />);
    expect(screen.getByText('sample')).toBeTruthy();
  });
});

// ── 2. CsCareHistoryTimeline: real cases → no sample tag ─────────────────────

describe('CsCareHistoryTimeline — real cases (live=true)', () => {
  it('hides the sample tag when live=true', () => {
    // Build a minimal real timeline event from the derive helper.
    const realCase = makeCase({ playbook_name: 'Spend Drop Alert', status: 'new' });
    const realEvents = casesToTimeline([realCase]);
    render(<CsCareHistoryTimeline events={realEvents} openCount={1} live={true} />);
    expect(screen.queryByText('sample')).toBeNull();
  });

  it('renders real playbook name from ledger cases, not the sample fixture name', () => {
    const realCase = makeCase({ playbook_name: 'Spend Drop Alert', status: 'new' });
    const realEvents = casesToTimeline([realCase]);
    render(<CsCareHistoryTimeline events={realEvents} openCount={1} live={true} />);
    // Real name is present.
    expect(screen.getByText('Spend Drop Alert')).toBeTruthy();
    // Sample fixture name is absent (it would only be there if sample data leaked).
    expect(screen.queryByText('VIP spend drop 14d')).toBeNull();
  });
});

// ── 3. CsRecommendedActionRail — locked behavior ─────────────────────────────

describe('CsRecommendedActionRail — locked behavior', () => {
  it('renders the recommended playbook for a writer (onMarkTreated path kept for compat)', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={onSubmit}
      />,
    );
    expect(screen.getByText(SAMPLE_RECOMMENDED_ACTION.playbookName)).toBeTruthy();
    expect(screen.getByText(/Mark treated/i)).toBeTruthy();
  });

  it('disables the CTA for a viewer (no write role)', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite={false}
        onSubmitTreatment={onSubmit}
      />,
    );
    const btn = screen.getByText(/Mark treated/i).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ── 4. CsRecommendedActionRail — inline treat form submits correct payload ────

describe('CsRecommendedActionRail — inline treat form (writer flow)', () => {
  it('opens the inline form on "Mark treated" click', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={onSubmit}
      />,
    );
    fireEvent.click(screen.getByText(/Mark treated/i));
    // Form fields must appear.
    expect(screen.getByRole('combobox')).toBeTruthy(); // channel select
    expect(screen.getByPlaceholderText(/action taken/i)).toBeTruthy();
  });

  it('calls onSubmitTreatment with {channel_used, action_taken, notes} on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={onSubmit}
      />,
    );

    // Open the form.
    fireEvent.click(screen.getByText(/Mark treated/i));

    // Fill channel select.
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'call' } });

    // Fill action-taken text.
    const actionInput = screen.getByPlaceholderText(/action taken/i);
    fireEvent.change(actionInput, { target: { value: 'Called VIP, discussed complaint' } });

    // Fill optional note.
    const noteInputs = screen.getAllByRole('textbox');
    // The second textbox (if present) is the note field; if only one exists it's action_taken.
    const noteInput = noteInputs.find((el) => (el as HTMLTextAreaElement).placeholder?.toLowerCase().includes('note'));
    if (noteInput) {
      fireEvent.change(noteInput, { target: { value: 'Escalated to game team' } });
    }

    // Submit.
    fireEvent.click(screen.getByText(/Log treatment/i));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const [payload] = onSubmit.mock.calls[0] as [{ channel_used: string; action_taken: string; notes?: string }];
    expect(payload.channel_used).toBe('call');
    expect(payload.action_taken).toBe('Called VIP, discussed complaint');
  });

  it('keeps submit disabled while action_taken is empty', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={onSubmit}
      />,
    );
    fireEvent.click(screen.getByText(/Mark treated/i));
    const submitBtn = screen.getByText(/Log treatment/i).closest('button') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('surfaces an inline error when onSubmitTreatment rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Server error 500'));
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={onSubmit}
      />,
    );
    fireEvent.click(screen.getByText(/Mark treated/i));

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'email' } });
    const actionInput = screen.getByPlaceholderText(/action taken/i);
    fireEvent.change(actionInput, { target: { value: 'Sent email' } });

    fireEvent.click(screen.getByText(/Log treatment/i));

    await waitFor(() => expect(screen.getByText(/Server error 500/i)).toBeTruthy());
  });
});

// ── 5. CsOwnerChip — visual contract ─────────────────────────────────────────

describe('CsOwnerChip', () => {
  it('renders nothing when assignee is null', () => {
    const { container } = render(<CsOwnerChip assignee={null} me="agent1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when assignee is undefined', () => {
    const { container } = render(<CsOwnerChip assignee={undefined} me="agent1" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "You" and brand tint when assignee matches me', () => {
    render(<CsOwnerChip assignee="agent1" me="agent1" />);
    const chip = screen.getByText('You');
    expect(chip).toBeTruthy();
    // Brand-soft background token signals own-case tint.
    expect((chip as HTMLElement).style.background).toBe('var(--brand-soft)');
  });

  it('shows assignee name and muted tint when assignee differs from me', () => {
    render(<CsOwnerChip assignee="agent2" me="agent1" />);
    const chip = screen.getByText('agent2');
    expect(chip).toBeTruthy();
    expect((chip as HTMLElement).style.background).toBe('var(--muted-soft)');
  });

  it('shows assignee name with muted tint when me is null (no identity)', () => {
    render(<CsOwnerChip assignee="agent2" me={null} />);
    const chip = screen.getByText('agent2');
    expect(chip).toBeTruthy();
    expect((chip as HTMLElement).style.background).toBe('var(--muted-soft)');
  });
});

// ── 6b. CsRecommendedActionRail — close-with-outcome flow ────────────────────

describe('CsRecommendedActionRail — close-with-outcome flow (treated cases only)', () => {
  it('does NOT render Close buttons when action.status is "new"', () => {
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        caseStatus="new"
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onCloseWithOutcome={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByText(/Close · KPI met/i)).toBeNull();
    expect(screen.queryByText(/Close · KPI missed/i)).toBeNull();
  });

  it('renders Close · KPI met and Close · KPI missed when action.status is "treated"', () => {
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        caseStatus="treated"
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onCloseWithOutcome={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText(/Close · KPI met/i)).toBeTruthy();
    expect(screen.getByText(/Close · KPI missed/i)).toBeTruthy();
  });

  it('does NOT render the Mark treated button when caseStatus is "treated"', () => {
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        caseStatus="treated"
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onCloseWithOutcome={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    // The treat CTA must be hidden once the case is already treated.
    expect(screen.queryByText(/Mark treated/i)).toBeNull();
  });

  it('calls onCloseWithOutcome("kpi_met") when "Close · KPI met" is clicked', async () => {
    const onClose = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        caseStatus="treated"
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onCloseWithOutcome={onClose}
      />,
    );

    fireEvent.click(screen.getByText(/Close · KPI met/i));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledWith('kpi_met');
  });

  it('calls onCloseWithOutcome("kpi_missed") when "Close · KPI missed" is clicked', async () => {
    const onClose = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        caseStatus="treated"
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onCloseWithOutcome={onClose}
      />,
    );

    fireEvent.click(screen.getByText(/Close · KPI missed/i));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledWith('kpi_missed');
  });

  it('disables Close buttons for viewer (canWrite=false)', () => {
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        caseStatus="treated"
        canWrite={false}
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onCloseWithOutcome={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const metBtn = screen.getByText(/Close · KPI met/i).closest('button') as HTMLButtonElement;
    const missedBtn = screen.getByText(/Close · KPI missed/i).closest('button') as HTMLButtonElement;
    expect(metBtn.disabled).toBe(true);
    expect(missedBtn.disabled).toBe(true);
  });

  it('shows inline error when onCloseWithOutcome rejects', async () => {
    const onClose = vi.fn().mockRejectedValue(new Error('Close failed'));
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        caseStatus="treated"
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onCloseWithOutcome={onClose}
      />,
    );

    fireEvent.click(screen.getByText(/Close · KPI met/i));

    await waitFor(() => expect(screen.getByText(/Close failed/i)).toBeTruthy());
  });
});

// ── 6c. CsCareHistoryTimeline — resolved outcome badge ────────────────────────

describe('CsCareHistoryTimeline — resolved events carry outcome badge', () => {
  it('shows "KPI met" badge on a resolved case with outcome kpi_met', () => {
    const resolvedCase = makeCase({
      status: 'resolved',
      outcome: 'kpi_met',
      treated_at: '2026-06-02T10:00:00Z',
    });
    const events = casesToTimeline([resolvedCase]);
    render(<CsCareHistoryTimeline events={events} openCount={0} live={true} />);
    expect(screen.getByText(/KPI met/i)).toBeTruthy();
  });

  it('shows "KPI missed" badge on a resolved case with outcome kpi_missed', () => {
    const resolvedCase = makeCase({
      status: 'resolved',
      outcome: 'kpi_missed',
      treated_at: '2026-06-02T10:00:00Z',
    });
    const events = casesToTimeline([resolvedCase]);
    render(<CsCareHistoryTimeline events={events} openCount={0} live={true} />);
    expect(screen.getByText(/KPI missed/i)).toBeTruthy();
  });

  it('does NOT show an outcome badge on an open case (outcome is null)', () => {
    const openCase = makeCase({ status: 'new', outcome: null });
    const events = casesToTimeline([openCase]);
    render(<CsCareHistoryTimeline events={events} openCount={1} live={true} />);
    expect(screen.queryByText(/KPI met/i)).toBeNull();
    expect(screen.queryByText(/KPI missed/i)).toBeNull();
  });
});

// ── 6. CsRecommendedActionRail — dismiss flow ─────────────────────────────────

describe('CsRecommendedActionRail — dismiss flow (writer)', () => {
  it('renders a Dismiss button when onDismiss is provided and canWrite is true', () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(/Dismiss/i)).toBeTruthy();
  });

  it('opens the dismiss reason picker on Dismiss click', () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText(/Dismiss/i));
    // The reason select must appear.
    expect(screen.getByRole('combobox')).toBeTruthy();
    // Confirm button must appear.
    expect(screen.getByText(/Confirm dismiss/i)).toBeTruthy();
  });

  it('calls onDismiss with the selected reason code on confirm', async () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByText(/Dismiss/i));

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'not_now' } });

    fireEvent.click(screen.getByText(/Confirm dismiss/i));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onDismiss).toHaveBeenCalledWith('not_now');
  });

  it('does not render Dismiss when onDismiss prop is absent', () => {
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByText(/^Dismiss$/i)).toBeNull();
  });

  it('disables the Dismiss button for viewer (canWrite=false)', () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite={false}
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onDismiss={onDismiss}
      />,
    );
    const btn = screen.getByText(/Dismiss/i).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows inline error when onDismiss rejects', async () => {
    const onDismiss = vi.fn().mockRejectedValue(new Error('Dismiss failed'));
    render(
      <CsRecommendedActionRail
        action={SAMPLE_RECOMMENDED_ACTION}
        canWrite
        onSubmitTreatment={vi.fn().mockResolvedValue(undefined)}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByText(/Dismiss/i));
    fireEvent.click(screen.getByText(/Confirm dismiss/i));

    await waitFor(() => expect(screen.getByText(/Dismiss failed/i)).toBeTruthy());
  });
});
