/**
 * Pure view-model for the lakehouse trajectory card: continuous day domain,
 * gap detection (missed nightly snapshots), stat-rail derivations, and number
 * formatting. Kept free of React so it's unit-testable without rendering.
 */

export interface SizePoint {
  date: string;
  members: number;
}

export interface DeltaPoint {
  date: string;
  entered: number;
  exited: number;
}

export interface TrajectoryPayload {
  segmentId: string;
  gameId: string;
  days: number;
  size: SizePoint[];
  delta: DeltaPoint[];
  empty: boolean;
}

export interface TrajectoryDay {
  date: string;
  /** null = no partition landed that day (missed night). */
  members: number | null;
  entered: number | null;
  exited: number | null;
}

export interface TrajectoryModel {
  days: TrajectoryDay[];
  gapCount: number;
  latestDate: string;
  latestMembers: number;
  /** % change vs the first landed snapshot in the window; null when only one point. */
  windowChangePct: number | null;
  latestEntered: number | null;
  latestExited: number | null;
  maxMembers: number;
  minMembers: number;
  maxDelta: number;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Stitch sparse size/delta series into one continuous day-by-day domain from
 * the first landed snapshot to the last, marking missing days as gaps.
 */
export function buildTrajectoryModel(payload: TrajectoryPayload): TrajectoryModel | null {
  if (payload.size.length === 0) return null;
  const sizeByDate = new Map(payload.size.map((p) => [p.date, p.members]));
  const deltaByDate = new Map(payload.delta.map((p) => [p.date, p]));

  const first = payload.size[0].date;
  const last = payload.size[payload.size.length - 1].date;
  const days: TrajectoryDay[] = [];
  let gapCount = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const members = sizeByDate.get(d) ?? null;
    const delta = deltaByDate.get(d);
    if (members == null) gapCount++;
    days.push({
      date: d,
      members,
      entered: delta?.entered ?? null,
      exited: delta?.exited ?? null,
    });
  }

  const landed = payload.size;
  const firstMembers = landed[0].members;
  const latestMembers = landed[landed.length - 1].members;
  const latestDelta = deltaByDate.get(last);
  const maxDelta = Math.max(
    1,
    ...payload.delta.map((p) => Math.max(p.entered, p.exited)),
  );

  return {
    days,
    gapCount,
    latestDate: last,
    latestMembers,
    windowChangePct:
      landed.length > 1 && firstMembers > 0
        ? ((latestMembers - firstMembers) / firstMembers) * 100
        : null,
    latestEntered: latestDelta?.entered ?? null,
    latestExited: latestDelta?.exited ?? null,
    maxMembers: Math.max(...landed.map((p) => p.members)),
    minMembers: Math.min(...landed.map((p) => p.members)),
    maxDelta,
  };
}

/** Compact human number: 7174638 → "7.17M", 38200 → "38.2k", 224 → "224". */
export function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

export function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}
