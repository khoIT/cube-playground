/**
 * Maps a segment's refresh MODE to a leading nav glyph, so the sidebar list
 * shows at a glance which segments are Live (predicate, auto re-evaluated) vs
 * Static (manual one-off upload). Mirrors the Live/Static vocabulary the
 * detail-header health pill uses (see segment-health.ts).
 */
import { Activity, Lock } from 'lucide-react';
import type { LucideIcon } from '../theme';
import type { SegmentType } from '../../types/segment-api';

export interface SegmentKindIcon {
  icon: LucideIcon;
  iconColor: string;
  /** Hover tooltip / aria word. */
  title: string;
}

export function segmentKindIcon(type: SegmentType | undefined): SegmentKindIcon {
  // Static / manual upload — a frozen list that never auto-refreshes.
  if (type === 'manual') {
    return { icon: Lock, iconColor: 'var(--shell-text-faint)', title: 'Static' };
  }
  // Predicate — auto re-evaluated on a cadence; the green pulse reads "Live".
  return { icon: Activity, iconColor: 'var(--success-ink)', title: 'Live' };
}
