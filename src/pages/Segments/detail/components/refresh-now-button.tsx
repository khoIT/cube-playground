/** "Refresh now" button — enqueues a manual refresh + reflects optimistic state. */

import { ReactElement, useState } from 'react';
import { Button, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { segmentsClient } from '../../../../api/segments-client';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  segment: Segment;
  onOptimistic?: () => void;
}

export function RefreshNowButton({ segment, onOptimistic }: Props): ReactElement | null {
  const [pending, setPending] = useState(false);
  if (segment.type !== 'predicate') return null;

  const handle = async () => {
    setPending(true);
    try {
      await segmentsClient.refresh(segment.id);
      onOptimistic?.();
      message.success('Refresh queued.');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      icon={<ReloadOutlined />}
      onClick={handle}
      loading={pending || segment.status === 'refreshing'}
    >
      Refresh now
    </Button>
  );
}
