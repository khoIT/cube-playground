/**
 * Tests for CacheSparkline:
 * - empty array → baseline line, no bars
 * - all-zero data → renders SVG (bars may be 1px minimum)
 * - real data → rect bars for hits rendered
 * - misses bar only rendered when misses > 0
 * - SVG dimensions respect props
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CacheSparkline } from '../cache-sparkline';
import type { CacheSparklineDay } from '../../../api/cache-effectiveness-types';

function makeDay(day: string, hits: number, misses: number): CacheSparklineDay {
  return { day, hits, misses };
}

describe('CacheSparkline', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <CacheSparkline data={[makeDay('2026-05-01', 10, 2)]} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('empty array renders baseline line, no rect bars', () => {
    const { container } = render(<CacheSparkline data={[]} />);
    expect(container.querySelector('[data-testid="cache-sparkline"]')).toBeTruthy();
    expect(container.querySelector('rect')).toBeNull();
    expect(container.querySelector('line')).toBeTruthy();
  });

  it('all-zero data renders SVG without crashing', () => {
    const data = [
      makeDay('2026-05-01', 0, 0),
      makeDay('2026-05-02', 0, 0),
    ];
    const { container } = render(<CacheSparkline data={data} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('real data renders hit bars (data-testid=bar-hits)', () => {
    const data = [
      makeDay('2026-05-01', 10, 2),
      makeDay('2026-05-02', 20, 5),
      makeDay('2026-05-03', 5, 1),
    ];
    const { container } = render(<CacheSparkline data={data} />);
    const hitBars = container.querySelectorAll('[data-testid="bar-hits"]');
    expect(hitBars.length).toBe(3);
  });

  it('miss bars only rendered when misses > 0', () => {
    const data = [
      makeDay('2026-05-01', 10, 0),
      makeDay('2026-05-02', 20, 5),
    ];
    const { container } = render(<CacheSparkline data={data} />);
    const missBars = container.querySelectorAll('[data-testid="bar-misses"]');
    // Only the second day has misses
    expect(missBars.length).toBe(1);
  });

  it('respects custom width and height', () => {
    const data = [makeDay('2026-05-01', 5, 1)];
    const { container } = render(<CacheSparkline data={data} width={300} height={60} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('300');
    expect(svg.getAttribute('height')).toBe('60');
    expect(svg.getAttribute('viewBox')).toBe('0 0 300 60');
  });

  it('single-point data (data.length === 1) renders a visible bar without crashing', () => {
    const { container } = render(
      <CacheSparkline data={[makeDay('2026-05-25', 5, 0)]} />,
    );
    // Bar chart works fine with 1 point — at least one rect should exist
    const hitBars = container.querySelectorAll('[data-testid="bar-hits"]');
    expect(hitBars.length).toBe(1);
  });

  it('renders one group per day', () => {
    const data = [
      makeDay('2026-05-01', 8, 2),
      makeDay('2026-05-02', 12, 3),
      makeDay('2026-05-03', 6, 1),
      makeDay('2026-05-04', 15, 0),
      makeDay('2026-05-05', 9, 4),
    ];
    const { container } = render(<CacheSparkline data={data} />);
    const groups = container.querySelectorAll('g');
    expect(groups.length).toBe(5);
  });
});
