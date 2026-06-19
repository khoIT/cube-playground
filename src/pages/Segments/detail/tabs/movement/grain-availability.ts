/**
 * Three-state view-grain availability, derived from the capture-coverage
 * timeline (`captureEras`). The Movement tab's binary "coarsest captured →
 * everything finer is greyed" clamp is too coarse: 15m can genuinely exist for
 * the last few days while the rest of a 30-day window is daily-only. This maps
 * each grain to full / partial / unavailable so the toggle and the coverage
 * strip can speak the truth.
 *
 *  - full        — captured at this grain (or finer) across the WHOLE window.
 *  - partial     — captured at this grain for SOME of the window; selecting it
 *                  shows real detail where it exists and carry-forward elsewhere.
 *  - unavailable — never captured this fine anywhere; the renderer could only
 *                  fabricate, so the option stays disabled.
 *
 * PURE — no I/O. A grain G is "covered" by an era when the era was captured at
 * G or finer (a finer capture always downsamples cleanly to a coarser view).
 */

import {
  MOVEMENT_GRANULARITIES,
  type MovementGranularity,
  type CaptureEra,
} from '../../../../../api/segment-movement-client';

export type GrainState = 'full' | 'partial' | 'unavailable';

export interface GrainAvailability {
  state: GrainState;
  /** Fraction of the captured window (by day-count) covered at this grain, 0..1. */
  coveredFraction: number;
  /** The covered sub-range for this grain (for "zoom to where it exists"),
   *  or null when nothing is covered. */
  range: { from: string; to: string } | null;
}

/** Inclusive day-count between two snapshot_ts strings (date portion only). */
function dayCount(from: string, to: string): number {
  const a = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(to.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Index in the coarse→fine list; larger = finer. */
function grainIndex(g: MovementGranularity): number {
  return MOVEMENT_GRANULARITIES.indexOf(g);
}

/**
 * Compute per-grain availability from the capture eras. When `eras` is empty
 * (no capture timeline — e.g. an older segment), daily is treated as the
 * universal floor (always available) and finer grains as unavailable, so the
 * toggle never disables every option.
 */
export function computeGrainAvailability(
  eras: CaptureEra[] | undefined,
): Record<MovementGranularity, GrainAvailability> {
  const out = {} as Record<MovementGranularity, GrainAvailability>;

  if (!eras || eras.length === 0) {
    for (const g of MOVEMENT_GRANULARITIES) {
      out[g] =
        g === 'daily'
          ? { state: 'full', coveredFraction: 1, range: null }
          : { state: 'unavailable', coveredFraction: 0, range: null };
    }
    return out;
  }

  const totalDays = eras.reduce((sum, e) => sum + dayCount(e.from, e.to), 0) || 1;

  for (const g of MOVEMENT_GRANULARITIES) {
    const gi = grainIndex(g);
    // Eras captured at this grain or finer cover grain G.
    const covering = eras.filter((e) => grainIndex(e.cadence) >= gi);
    const coveredDays = covering.reduce((sum, e) => sum + dayCount(e.from, e.to), 0);
    const fraction = coveredDays / totalDays;

    let state: GrainState = 'unavailable';
    if (fraction >= 0.999) state = 'full';
    else if (fraction > 0) state = 'partial';

    const range =
      covering.length > 0
        ? { from: covering[0].from, to: covering[covering.length - 1].to }
        : null;

    out[g] = { state, coveredFraction: fraction, range };
  }

  return out;
}

/** A grain is selectable in the toggle when it is not entirely unavailable. */
export function isGrainSelectable(a: GrainAvailability | undefined): boolean {
  return a != null && a.state !== 'unavailable';
}

/**
 * The grain to fall back to when the active selection becomes unavailable:
 * the finest grain that is `full` (always at least daily). Keeps the toggle
 * from landing on a disabled option after a window/segment change.
 */
export function finestFullGrain(
  availability: Record<MovementGranularity, GrainAvailability>,
): MovementGranularity {
  for (let i = MOVEMENT_GRANULARITIES.length - 1; i >= 0; i--) {
    const g = MOVEMENT_GRANULARITIES[i];
    if (availability[g]?.state === 'full') return g;
  }
  return 'daily';
}
