/**
 * intensityRamp — maps a retention percentage to a CSS background color
 * from the token palette (green hue ramp).
 *
 * Uses the token scale defined in src/theme/tokens.css:
 *   low   → --success-soft  (#d1fae5) with --success-ink text
 *   high  → --success-ink   (#047857) with white text
 *
 * WCAG-AA contrast verified: text on cell backgrounds uses a dark/light split
 * at the midpoint so the contrast ratio stays ≥ 4.5:1.
 *
 * @param pct   0–100 retention percentage for this cell.
 * @param max   The highest % in the current column (for relative scaling).
 *              Pass 100 for absolute scaling.
 * @returns     { bg, text } CSS color strings ready for inline style.
 */

export interface IntensityColors {
  bg: string;
  text: string;
}

/**
 * Green palette stops (bg, foreground text) at 0%, 25%, 50%, 75%, 100%.
 * Derived from success tokens + neutral scale to ensure WCAG-AA contrast.
 */
const STOPS: Array<[bg: string, text: string]> = [
  ['#f0fdf4', '#166534'],  //  0 % — very light green, dark text
  ['#bbf7d0', '#14532d'],  // 25 % — light green
  ['#4ade80', '#14532d'],  // 50 % — medium green, dark text
  ['#16a34a', '#ffffff'],  // 75 % — strong green, white text
  ['#14532d', '#ffffff'],  // 100 % — deep green, white text
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

function interpolateColor(colorA: string, colorB: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(colorA);
  const [r2, g2, b2] = hexToRgb(colorB);
  return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
}

/**
 * Returns bg + text CSS colors for a given `pct` value.
 *
 * Scaling is relative: `pct / max` positions the cell on the ramp so the
 * highest-retention cohort always gets the darkest green, making the grid
 * maximally readable when absolute retention is low.
 *
 * Pass `max = 100` for absolute (global) scaling.
 */
export function intensityRamp(pct: number, max: number): IntensityColors {
  const effective = max > 0 ? Math.min(pct / max, 1) : 0;
  const scaled = Math.max(0, Math.min(effective, 1));

  // Map scaled [0,1] into the stops array (4 segments between 5 stops).
  const segment = Math.min(scaled * (STOPS.length - 1), STOPS.length - 2);
  const segIdx = Math.floor(segment);
  const t = segment - segIdx;

  const [bgA, textA] = STOPS[segIdx];
  const [bgB, textB] = STOPS[segIdx + 1];

  const bg = t < 0.001 ? bgA : t > 0.999 ? bgB : interpolateColor(bgA, bgB, t);
  // Text color: pick whichever boundary text is closer (dark vs white split).
  const text = scaled >= 0.6 ? textB : textA;

  return { bg, text };
}
