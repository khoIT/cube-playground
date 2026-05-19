/** Banner shown when a segment is in 'broken' state. */

import { ReactElement } from 'react';
import { Alert, Button } from 'antd';
import { useHistory } from 'react-router-dom';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  segment: Segment;
}

export function BrokenSegmentBanner({ segment }: Props): ReactElement | null {
  const history = useHistory();
  if (segment.status !== 'broken') return null;

  return (
    <Alert
      type="error"
      showIcon
      message={`This segment is broken: ${segment.broken_reason ?? 'unknown error'}`}
      action={
        <Button size="small" onClick={() => history.push(`/segments/${segment.id}/edit`)}>
          Edit predicate to fix
        </Button>
      }
    />
  );
}
