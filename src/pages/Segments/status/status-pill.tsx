/** Shared status pill for a segment's lifecycle state. */

import { ReactElement } from 'react';
import { Tooltip } from 'antd';
import type { SegmentStatus } from '../../../types/segment-api';

interface Props {
  status: SegmentStatus;
  reason?: string | null;
}

const STYLES: Record<SegmentStatus, { bg: string; fg: string; label: string }> = {
  fresh:      { bg: 'rgba(16,185,129,0.12)',  fg: '#0f9469', label: 'fresh' },
  refreshing: { bg: 'rgba(40,95,245,0.12)',   fg: '#285ff5', label: 'refreshing' },
  stale:      { bg: 'rgba(245,158,11,0.16)',  fg: '#b07000', label: 'stale' },
  broken:     { bg: 'rgba(220,38,38,0.12)',   fg: '#b91c1c', label: 'broken' },
};

export function StatusPill({ status, reason }: Props): ReactElement {
  const s = STYLES[status];
  const pill = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 8px',
        borderRadius: 6,
        fontSize: 11.5,
        fontWeight: 500,
        background: s.bg,
        color: s.fg,
      }}
    >
      {s.label}
    </span>
  );
  if (status === 'broken' && reason) {
    return <Tooltip title={reason}>{pill}</Tooltip>;
  }
  return pill;
}
