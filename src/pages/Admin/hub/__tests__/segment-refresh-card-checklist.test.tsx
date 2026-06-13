/**
 * CardStatusChecklist — persisted per-card picture: tally header, three tones
 * (ok / serving last-good / failing), hidden with no cards.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CardStatusChecklist } from '../segment-refresh-card-checklist';
import type { SegmentCardStatus } from '../../../../types/segment-refresh-ops';

const NOW = Date.parse('2026-06-13T01:00:00.000Z');

const card = (over: Partial<SegmentCardStatus>): SegmentCardStatus => ({
  cardId: 'kpi:x',
  status: 'ok',
  error: null,
  fetchedAt: '2026-06-13T00:50:00.000Z', // 10m before NOW
  lastAttemptAt: '2026-06-13T00:55:00.000Z',
  ...over,
});

describe('CardStatusChecklist', () => {
  it('tallies and tones the three card states', () => {
    render(
      <CardStatusChecklist
        now={NOW}
        cards={[
          card({ cardId: 'kpi:ok' }),
          card({ cardId: 'kpi:stale', error: 'timed out after 4s', fetchedAt: '2026-06-12T19:00:00.000Z' }),
          card({ cardId: 'kpi:down', status: 'error', error: 'no pre-agg' }),
        ]}
      />,
    );

    expect(screen.getByText('Cards (3)')).toBeTruthy();
    expect(screen.getByText('1 ok')).toBeTruthy();
    expect(screen.getByText('1 serving last-good')).toBeTruthy();
    expect(screen.getByText('1 failing')).toBeTruthy();
    // The stale card dates its LAST-GOOD value (6h before NOW).
    expect(screen.getByText('last-good 6h 0m ago')).toBeTruthy();
    expect(screen.getByText('kpi:down')).toBeTruthy();
    expect(screen.getByText('failing')).toBeTruthy();
  });

  it('renders nothing with no cached cards', () => {
    const { container } = render(<CardStatusChecklist cards={[]} now={NOW} />);
    expect(container.firstChild).toBeNull();
  });
});
