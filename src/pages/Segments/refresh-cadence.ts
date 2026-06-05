/**
 * Shared refresh-cadence options + label helper.
 *
 * Single source for the cadence choices offered both in the predicate editor's
 * "Refresh behaviour" card and in the detail header's quick-change popover, so
 * the two never drift (e.g. both include 12h / 720m).
 */

export interface CadenceOption {
  /** Minutes between automatic refreshes. */
  value: number;
  label: string;
}

export const CADENCE_OPTIONS: CadenceOption[] = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
  { value: 360, label: '6 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
];

/** Human label for any cadence, including values not in CADENCE_OPTIONS. */
export function cadenceLabel(min: number): string {
  const known = CADENCE_OPTIONS.find((o) => o.value === min);
  if (known) return known.label;
  if (min % 1440 === 0) return `${min / 1440} days`;
  if (min % 60 === 0) return `${min / 60} hours`;
  return `${min} minutes`;
}

/**
 * Cadence options to render for a segment whose current cadence may be a legacy
 * value outside the standard list — prepend it so it stays selectable/visible.
 */
export function cadenceOptionsFor(currentMin: number): CadenceOption[] {
  if (CADENCE_OPTIONS.some((o) => o.value === currentMin)) return CADENCE_OPTIONS;
  return [{ value: currentMin, label: cadenceLabel(currentMin) }, ...CADENCE_OPTIONS];
}

/** Compact label for tight controls (segmented control): "15m", "1h", "1d". */
export function cadenceShortLabel(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}m`;
}
