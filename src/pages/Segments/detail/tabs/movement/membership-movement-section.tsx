/**
 * Membership movement section — member_count / entered / exited over time.
 * Also the authority for the tab's shared granularity clamp + freshness: it
 * reports its response's effectiveGranularity / asOf / stale up to the tab.
 */

import { ReactElement, useEffect } from 'react';
import {
  segmentMovementClient,
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
  onMeta: (meta: {
    effective: MovementGranularity;
    finest?: MovementGranularity;
    captureEras?: CaptureEra[];
  }) => void;
}

export function MembershipMovementSection({ segmentId, granularity, days, onMeta }: Props): ReactElement {
  const { data, loading, error } = useMovementResource(
    () => segmentMovementClient.movement(segmentId, { granularity, days }),
    [segmentId, granularity, days],
  );

  useEffect(() => {
    if (data) {
      onMeta({
        effective: data.effectiveGranularity,
        finest: data.finestGranularity,
        captureEras: data.captureEras,
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
