/**
 * Membership movement section — member_count / entered / exited over time.
 * Also the authority for the tab's shared granularity clamp + freshness: it
 * reports its response's effectiveGranularity / asOf / stale up to the tab.
 */

import { ReactElement, useEffect } from 'react';
import {
  segmentMovementClient,
  type CadenceChange,
  type CaptureEra,
  type MovementGranularity,
} from '../../../../../api/segment-movement-client';
import { useMovementResource } from './use-movement-resource';
import { buildMembershipChart } from './build-movement-chart';
import { MovementSection } from './movement-section';

interface Props {
  segmentId: string;
  granularity: MovementGranularity;
  days: number;
  /** Explicit window from the tab range picker; overrides `days` when set. */
  from?: string;
  to?: string;
  onMeta: (meta: {
    effective: MovementGranularity;
    finest?: MovementGranularity;
    captureEras?: CaptureEra[];
    /** Freshness + cadence annotations lifted to the tab control bar. */
    asOf?: string | null;
    cadenceChanges?: CadenceChange[];
    stale?: boolean;
    /** Buckets held flat (view grain finer than capture) — surfaced as a top pill. */
    carryForward?: string[];
  }) => void;
}

export function MembershipMovementSection({ segmentId, granularity, days, from, to, onMeta }: Props): ReactElement {
  const { data, loading, error } = useMovementResource(
    () => segmentMovementClient.movement(segmentId, { granularity, days, from, to }),
    [segmentId, granularity, days, from, to],
  );

  useEffect(() => {
    if (data) {
      onMeta({
        effective: data.effectiveGranularity,
        finest: data.finestGranularity,
        captureEras: data.captureEras,
        asOf: data.asOf,
        cadenceChanges: data.cadenceChanges,
        stale: data.stale,
        carryForward: data.carryForward,
      });
    }
  }, [data, onMeta]);

  const artifact = data ? buildMembershipChart(segmentId, 'Membership movement', data.points) : null;

  return (
    <MovementSection
      title="Membership movement"
      loading={loading}
      error={error}
      artifact={artifact}
      asOf={data?.asOf ?? null}
      stale={data?.stale}
      cadenceChanges={data?.cadenceChanges}
      carryForward={data?.carryForward}
      emptyHint="No membership snapshots captured in this range yet."
    />
  );
}
