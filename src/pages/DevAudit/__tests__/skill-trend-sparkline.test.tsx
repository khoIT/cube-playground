/**
 * Tests for SkillTrendSparkline:
 * - empty array renders baseline (no polyline)
 * - all-zero array renders baseline (no polyline)
 * - non-zero data renders a polyline with correct point count
 * - SVG dimensions respect width/height props
 * - single-point data renders without crash
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkillTrendSparkline } from '../skill-trend-sparkline';

describe('SkillTrendSparkline', () => {
  it('renders an SVG element', () => {
    const { container } = render(<SkillTrendSparkline data={[1, 2, 3]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('empty data renders baseline line, no polyline', () => {
    const { container } = render(<SkillTrendSparkline data={[]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeNull();
    const line = container.querySelector('line');
    expect(line).toBeTruthy();
  });

  it('all-zero data still renders a polyline (guard: max=1 prevents division by zero)', () => {
    const { container } = render(<SkillTrendSparkline data={[0, 0, 0, 0]} />);
    const polyline = container.querySelector('polyline');
    // All zeros → points are all at the bottom, but polyline still renders
    expect(polyline).toBeTruthy();
    const pts = polyline!.getAttribute('points');
    expect(pts).toBeTruthy();
    // Should have 4 space-separated coordinate pairs
    expect(pts!.trim().split(' ')).toHaveLength(4);
  });

  it('renders polyline with correct point count matching data length', () => {
    const data = [10, 5, 8, 3, 12, 7, 9];
    const { container } = render(<SkillTrendSparkline data={data} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeTruthy();
    const pts = polyline!.getAttribute('points')!.trim().split(' ');
    expect(pts).toHaveLength(data.length);
  });

  it('respects custom width and height', () => {
    const { container } = render(<SkillTrendSparkline data={[1, 2, 3]} width={120} height={40} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.getAttribute('height')).toBe('40');
    expect(svg.getAttribute('viewBox')).toBe('0 0 120 40');
  });

  it('single-point data renders without crashing', () => {
    const { container } = render(<SkillTrendSparkline data={[5]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeTruthy();
  });

  it('title element shows total count', () => {
    const { container } = render(<SkillTrendSparkline data={[3, 4, 5]} />);
    const title = container.querySelector('title');
    expect(title).toBeTruthy();
    expect(title!.textContent).toBe('12 total');
  });

  it('title is absent for empty data (baseline mode)', () => {
    const { container } = render(<SkillTrendSparkline data={[]} />);
    const title = container.querySelector('title');
    expect(title).toBeNull();
  });
});
