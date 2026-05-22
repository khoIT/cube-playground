/** Banner shown when a segment is in 'broken' state. */

import { ReactElement } from 'react';
import { Alert, Button, Space } from 'antd';
import { useHistory } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  segment: Segment;
  onViewRefreshLog?: () => void;
}

export function BrokenSegmentBanner({ segment, onViewRefreshLog }: Props): ReactElement | null {
  const { t } = useTranslation();
  const history = useHistory();
  if (segment.status !== 'broken') return null;

  const reason = segment.broken_reason ?? t(
    'segments.detail.broken.unknownReason',
    { defaultValue: 'unknown error — see refresh log for details' },
  );

  return (
    <Alert
      type="error"
      showIcon
      message={t('segments.detail.broken.title', {
        defaultValue: 'Refresh failed — this segment is broken',
      })}
      description={<pre style={{
        margin: '4px 0 0 0',
        padding: 0,
        font: 'inherit',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--text-primary)',
      }}>{reason}</pre>}
      action={
        <Space direction="vertical" size={6}>
          {onViewRefreshLog != null && (
            <Button size="small" onClick={onViewRefreshLog}>
              {t('segments.detail.broken.viewRefreshLog', {
                defaultValue: 'View refresh log',
              })}
            </Button>
          )}
          <Button
            size="small"
            type="primary"
            onClick={() => history.push(`/segments/${segment.id}/edit`)}
            disabled={segment.type !== 'predicate'}
          >
            {t('segments.detail.broken.editPredicate', {
              defaultValue: 'Edit predicate',
            })}
          </Button>
        </Space>
      }
    />
  );
}
