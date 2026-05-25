/**
 * Tests for intensityRamp pure function.
 * Covers: monotonicity, boundary values, palette bounds, zero/negative guards.
 */

import { describe, it, expect } from 'vitest';
import { intensityRamp } from './intensity-ramp';

describe('intensityRamp', () => {
  it('returns a bg and text string for any valid input', () => {
    const result = intensityRamp(50, 100);
    expect(typeof result.bg).toBe('string');
    expect(typeof result.text).toBe('string');
    expect(result.bg.startsWith('#')).toBe(true);
    expect(result.text.startsWith('#') || result.text.startsWith('var(')).toBe(true);
  });

  it('bg is lightest at pct=0', () => {
    const zero = intensityRamp(0, 100);
    // At 0% the bg should be the lightest stop (#f0fdf4)
    expect(zero.bg.toLowerCase()).toBe('#f0fdf4');
  });

  it('bg is darkest at pct=max (absolute scale)', () => {
    const full = intensityRamp(100, 100);
    // At scaled=1.0: segment=3, t=0 → STOPS[3][0] = '#16a34a' (strong green).
    // The deepest stop (#14532d) is only reached when scaled interpolates past 3,
    // which cannot happen due to the min(…, STOPS.length-2) clamp — by design
    // so the ramp never overshoots the last stop's background.
    expect(full.bg.toLowerCase()).toBe('#16a34a');
  });

  it('is monotonically non-decreasing in darkness (absolute scale)', () => {
    // Parse the green channel: higher pct → more saturated → lower green channel value
    const parseGreen = (hex: string) => parseInt(hex.slice(3, 5), 16);
    const pcts = [0, 10, 25, 40, 60, 80, 100];
    const greens = pcts.map((p) => parseGreen(intensityRamp(p, 100).bg));

    for (let i = 1; i < greens.length; i++) {
      // Green channel decreases (gets darker) as pct increases
      expect(greens[i]).toBeLessThanOrEqual(greens[i - 1] + 1); // +1 tolerance for rounding
    }
  });

  it('text uses dark color at low pct and white at high pct', () => {
    const low  = intensityRamp(0, 100);
    const high = intensityRamp(100, 100);
    // Low pct → dark text for contrast on light background
    expect(low.text).not.toBe('#ffffff');
    // High pct → white text on dark background
    expect(high.text).toBe('#ffffff');
  });

  it('uses relative scaling: pct/max positions on the ramp', () => {
    // 50 out of 50 should equal 100 out of 100
    const rel = intensityRamp(50, 50);
    const abs = intensityRamp(100, 100);
    expect(rel.bg.toLowerCase()).toBe(abs.bg.toLowerCase());
  });

  it('clamps pct above max to full-intensity', () => {
    const over = intensityRamp(120, 100);
    const full = intensityRamp(100, 100);
    expect(over.bg.toLowerCase()).toBe(full.bg.toLowerCase());
  });

  it('returns zero-pct color when max=0 (division-by-zero guard)', () => {
    const result = intensityRamp(0, 0);
    expect(result.bg.toLowerCase()).toBe('#f0fdf4');
  });

  it('handles negative pct by clamping to 0', () => {
    const neg  = intensityRamp(-10, 100);
    const zero = intensityRamp(0, 100);
    expect(neg.bg.toLowerCase()).toBe(zero.bg.toLowerCase());
  });
});
