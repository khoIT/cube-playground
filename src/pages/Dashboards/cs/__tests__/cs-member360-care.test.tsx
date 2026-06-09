/**
 * Phase-5 CS care-first 360: the care timeline + recommended-action rail are the
 * designed sample stub. These verify the user-facing contract — the timeline is
 * clearly labelled "sample", the live open-count anchors it, and the rail's
 * "Mark treated" CTA is role-gated and fires its callback.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CsCareHistoryTimeline } from '../member360/cs-care-history-timeline';
import { CsRecommendedActionRail } from '../member360/cs-recommended-action-rail';
import { SAMPLE_CARE_TIMELINE, SAMPLE_RECOMMENDED_ACTION } from '../member360/cs-member360-mock';

describe('CsCareHistoryTimeline', () => {
  it('labels the timeline as a sample and shows the live open count', () => {
    render(<CsCareHistoryTimeline events={SAMPLE_CARE_TIMELINE} openCount={3} />);
    expect(screen.getByText('sample')).toBeTruthy();
    expect(screen.getByText('3 open')).toBeTruthy();
    // At least one matched-playbook pill from the sample.
    expect(screen.getAllByText('VIP spend drop 14d').length).toBeGreaterThan(0);
  });

  it('omits the open badge when the count is unknown', () => {
    render(<CsCareHistoryTimeline events={SAMPLE_CARE_TIMELINE} openCount={null} />);
    expect(screen.queryByText(/\d+ open/)).toBeNull();
  });
});

describe('CsRecommendedActionRail', () => {
  it('renders the recommended playbook + fires onMarkTreated for a writer', () => {
    const onMark = vi.fn();
    render(
      <CsRecommendedActionRail action={SAMPLE_RECOMMENDED_ACTION} treated={false} onMarkTreated={onMark} canWrite />,
    );
    expect(screen.getByText(SAMPLE_RECOMMENDED_ACTION.playbookName)).toBeTruthy();
    fireEvent.click(screen.getByText(/Mark treated/i));
    expect(onMark).toHaveBeenCalledTimes(1);
  });

  it('shows the logged confirmation when treated', () => {
    render(
      <CsRecommendedActionRail action={SAMPLE_RECOMMENDED_ACTION} treated onMarkTreated={() => {}} canWrite />,
    );
    expect(screen.getByText(/Logged to timeline/i)).toBeTruthy();
  });

  it('disables the CTA for a viewer (no write role)', () => {
    const onMark = vi.fn();
    render(
      <CsRecommendedActionRail action={SAMPLE_RECOMMENDED_ACTION} treated={false} onMarkTreated={onMark} canWrite={false} />,
    );
    const btn = screen.getByText(/Mark treated/i).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onMark).not.toHaveBeenCalled();
  });
});
