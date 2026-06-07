/**
 * ShareSegmentControl — detail-header sharing affordance.
 *
 * Owner: Share / Unshare toggle (server enforces owner-or-admin; an 'org'
 * demotion by a non-admin owner surfaces the server's 403 as a toast).
 * Non-owner: static "Shared by {owner}" chip — sharing state is owned by
 * the segment's owner, the viewer only sees attribution.
 */
import { ReactElement, useState } from 'react';
import { Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Share2 } from 'lucide-react';
import type { Segment } from '../../../../types/segment-api';
import { segmentsClient } from '../../../../api/segments-client';
import { SegmentApiError } from '../../../../api/api-client';
import { invalidateSegmentIds } from '../../use-segment-ids';

interface ShareSegmentControlProps {
  segment: Segment;
  onChange: (updated: Segment) => void;
}

export function ShareSegmentControl({ segment, onChange }: ShareSegmentControlProps): ReactElement {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  if (!segment.is_owner) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--info-soft)',
          color: 'var(--info-ink)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}
      >
        <Share2 size={11} aria-hidden />
        {t('segments.detail.share.sharedBy', {
          defaultValue: 'Shared by {{owner}}',
          owner: segment.owner_label ?? segment.owner,
        })}
      </span>
    );
  }

  const isShared = segment.visibility === 'shared' || segment.visibility === 'org';

  async function toggle(): Promise<void> {
    setBusy(true);
    try {
      const updated = isShared
        ? await segmentsClient.unshare(segment.id)
        : await segmentsClient.share(segment.id);
      onChange(updated);
      // Sidebar caches the segments list (shared group + recents pruning).
      invalidateSegmentIds();
      message.success(
        isShared
          ? t('segments.detail.share.unshareSuccess', { defaultValue: 'Segment is private again' })
          : t('segments.detail.share.shareSuccess', { defaultValue: 'Segment shared with the team' }),
      );
    } catch (err) {
      const reason =
        err instanceof SegmentApiError
          ? err.message
          : t('segments.detail.share.error', { defaultValue: 'Could not update sharing' });
      message.error(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="small" loading={busy} onClick={toggle} icon={<Share2 size={12} aria-hidden />}>
      {isShared
        ? t('segments.detail.share.unshare', { defaultValue: 'Unshare' })
        : t('segments.detail.share.share', { defaultValue: 'Share' })}
    </Button>
  );
}
