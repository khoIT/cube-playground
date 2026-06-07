/**
 * chart-heatmap behaviours:
 *  - canonicalAxisOrder re-sorts time-like axes (weekday/month/hour/number)
 *    and leaves categorical axes in submitted order
 *  - heatColor scales against [min, max] of present cells so narrow
 *    high-band grids ("top N cells by value") still differentiate
 *  - ChartHeatmap renders weekday rows in Mon..Sun order even when the
 *    query returns rows value-sorted
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { canonicalAxisOrder, padTimeAxis } from '../components/chart-heatmap-axis-order';
import { ChartHeatmap, heatColor } from '../components/chart-heatmap';
import type { ChartSpec } from '../../../api/chat-sse-client';

describe('canonicalAxisOrder', () => {
  it('sorts weekday abbreviations Mon..Sun regardless of submitted order', () => {
    expect(canonicalAxisOrder(['Mon', 'Tue', 'Wed', 'Thu', 'Sun', 'Fri', 'Sat'])).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ]);
  });

  it('sorts full weekday names case-insensitively', () => {
    expect(canonicalAxisOrder(['sunday', 'Wednesday', 'MONDAY'])).toEqual([
      'MONDAY', 'Wednesday', 'sunday',
    ]);
  });

  it('sorts month names Jan..Dec', () => {
    expect(canonicalAxisOrder(['Mar', 'Jan', 'Dec', 'Feb'])).toEqual([
      'Jan', 'Feb', 'Mar', 'Dec',
    ]);
  });

  it('sorts hour-like strings ("13h", "04h") numerically', () => {
    expect(canonicalAxisOrder(['13h', '12h', '14h', '04h', '02h'])).toEqual([
      '02h', '04h', '12h', '13h', '14h',
    ]);
  });

  it('sorts numbers and numeric strings ascending', () => {
    expect(canonicalAxisOrder([13, 2, 7])).toEqual([2, 7, 13]);
    expect(canonicalAxisOrder(['13', '2', '7'])).toEqual(['2', '7', '13']);
  });

  it('sorts HH:MM clock strings by time of day', () => {
    expect(canonicalAxisOrder(['13:30', '04:00', '13:05'])).toEqual([
      '04:00', '13:05', '13:30',
    ]);
  });

  it('keeps categorical axes in submitted order', () => {
    expect(canonicalAxisOrder(['Facebook', 'Vungle', 'AppLovin'])).toEqual([
      'Facebook', 'Vungle', 'AppLovin',
    ]);
    // Mixed weekday + categorical → not a time axis, keep as-is.
    expect(canonicalAxisOrder(['Mon', 'Promo'])).toEqual(['Mon', 'Promo']);
  });
});

describe('padTimeAxis', () => {
  it('pads an hour-like axis to the full 00h..23h range, keeping input labels', () => {
    const padded = padTimeAxis(['02h', '04h', '13h']);
    expect(padded).toHaveLength(24);
    expect(padded[0]).toBe('00h'); // synthesised, zero-padded to match input
    expect(padded[2]).toBe('02h'); // original label preserved (cell-lookup key)
    expect(padded[23]).toBe('23h');
  });

  it('mirrors unpadded input style when synthesising hour labels', () => {
    const padded = padTimeAxis(['2h', '13h']);
    expect(padded[0]).toBe('0h');
    expect(padded[2]).toBe('2h');
  });

  it('pads weekdays to all 7 days in Mon..Sun order', () => {
    expect(padTimeAxis(['Mon', 'Wed', 'Sun'])).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ]);
  });

  it('leaves categorical and out-of-range axes untouched', () => {
    expect(padTimeAxis(['Facebook', 'Vungle'])).toEqual(['Facebook', 'Vungle']);
    expect(padTimeAxis(['13h', '40h'])).toEqual(['13h', '40h']); // not hours-of-day
  });
});

describe('heatColor', () => {
  it('spreads a narrow high band across the full ramp (min–max scaling)', () => {
    const lo = heatColor(125_000, 125_000, 217_000);
    const hi = heatColor(217_000, 125_000, 217_000);
    expect(lo.bg).toBe('#fef3c7'); // lightest stop, not mid-orange
    expect(hi.bg).toBe('#7f1d1d'); // darkest stop
    expect(lo.bg).not.toBe(hi.bg);
  });

  it('uses dark text on light cells and white text on deep cells', () => {
    expect(heatColor(0, 0, 100).text).toBe('#78350f');
    expect(heatColor(100, 0, 100).text).toBe('#ffffff');
  });

  it('places all-equal grids mid-ramp instead of all-dark', () => {
    const c = heatColor(50, 50, 50);
    expect(c.bg).toBe('#fb923c'); // 50% stop
  });

  it('handles an all-zero grid without NaN colors', () => {
    const c = heatColor(0, 0, 0);
    expect(c.bg).toBe('#fef3c7');
  });
});

describe('ChartHeatmap weekday row ordering', () => {
  it('renders rows Mon..Sun even when data arrives value-sorted', () => {
    // Submitted order mimics a "top cells by volume" query: Sun's best cell
    // outranks Fri's and Sat's, so Sun appears first in the data.
    const spec: ChartSpec = {
      type: 'heatmap',
      title: 'Logins by hour × weekday',
      data: [
        { dow: 'Mon', hour: '13h', v: 217 },
        { dow: 'Sun', hour: '13h', v: 166 },
        { dow: 'Fri', hour: '13h', v: 164 },
        { dow: 'Sat', hour: '13h', v: 161 },
      ],
      encoding: { category: 'hour', value: 'v', series: 'dow' },
    } as ChartSpec;

    render(<ChartHeatmap spec={spec} labels={{}} formatValue={(v) => String(v)} />);

    const grid = screen.getByRole('table');
    const text = grid.textContent ?? '';
    const order = ['Mon', 'Fri', 'Sat', 'Sun'].map((d) => text.indexOf(d));
    expect(order).toEqual([...order].sort((a, b) => a - b)); // Mon < Fri < Sat < Sun
  });
});
