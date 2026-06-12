/**
 * DetailHeaderActions — segment detail header action cluster.
 *
 * Secondary actions (Share / Refresh / Open in Playground) share one bordered
 * segmented "command bar" so they read as a single toolbox with uniform
 * sizing; "Edit predicate" stays the only filled (primary) button; the
 * destructive Delete is demoted into a ⋯ overflow menu so it never sits one
 * slip away from the primary CTA.
 */
import { ReactElement } from 'react';
import { Button, Dropdown, Menu, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import { ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react';
import type { Segment } from '../../../../types/segment-api';
import type { Preset } from '../../presets/types';
import {
  buildDefinitionDeeplink,
} from '../../../../utils/playground-deeplink';
import { RefreshNowButton } from './refresh-now-button';
import { ShareSegmentControl } from './share-segment-control';
import styles from '../../segments.module.css';

interface DetailHeaderActionsProps {
  segment: Segment;
  preset: Preset | null;
  onSegmentChange: (updated: Segment) => void;
  /** Opens the delete confirmation modal owned by the detail view. */
  onDelete: () => void;
}

export function DetailHeaderActions({
  segment,
  preset,
  onSegmentChange,
  onDelete,
}: DetailHeaderActionsProps): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();

  // Extract the cube-level segments sidecar from the stored query so the
  // definition deeplink carries the same scope constraints the refresh uses.
  // We parse only the segments[] array — not dates or filters — to avoid the
  // relative-date freeze problem (see predicate-tree-to-cube-query.ts).
  const cubeSegments: string[] = (() => {
    if (!segment.cube_query_json) return [];
    try {
      const parsed = JSON.parse(segment.cube_query_json) as Record<string, unknown>;
      const segs = parsed.segments;
      return Array.isArray(segs) ? (segs as string[]) : [];
    } catch {
      return [];
    }
  })();

  const identityDim = preset?.identityDim ?? `${segment.cube ?? ''}.user_id`;

  const deeplinkResult = buildDefinitionDeeplink({
    segment,
    identityDim,
    cubeSegments,
    gameId: segment.game_id,
  });

  const isDisabled = 'disabled' in deeplinkResult;
  const disabledReason = isDisabled ? deeplinkResult.reason : undefined;

  const openInPlayground = (): void => {
    if (isDisabled) return;
    window.location.assign(deeplinkResult.url);
  };

  const openButton = (
    <Button
      icon={<ExternalLink size={13} aria-hidden />}
      onClick={openInPlayground}
      disabled={isDisabled}
    >
      {t('segments.detail.actions.openInPlayground', { defaultValue: 'Open in Playground' })}
    </Button>
  );

  return (
    <div className={styles.detailActions}>
      {/* Non-admin share state renders as a passive "Shared by {owner}" chip —
          it lives outside the command bar so the bar only ever holds buttons. */}
      {!segment.can_administer && (
        <ShareSegmentControl segment={segment} onChange={onSegmentChange} />
      )}
      <div className={styles.commandBar}>
        {segment.can_administer && (
          <ShareSegmentControl segment={segment} onChange={onSegmentChange} />
        )}
        <RefreshNowButton segment={segment} />
        {isDisabled ? (
          <Tooltip title={disabledReason}>
            {/* Tooltip requires a DOM element child when the button is disabled */}
            <span>{openButton}</span>
          </Tooltip>
        ) : (
          openButton
        )}
      </div>
      {/* Cohort-redefining entry point — predicate/uid rewrites are
          owner-or-admin on the server; can_administer mirrors that. */}
      <Button
        type="primary"
        disabled={!segment.can_administer}
        title={
          segment.can_administer
            ? undefined
            : t('segments.detail.share.ownerOnly', { defaultValue: 'Owner or admin only' })
        }
        onClick={() =>
          history.push(
            segment.type === 'predicate'
              ? `/segments/${segment.id}/edit`
              : `/segments/${segment.id}/edit?convert=live`,
          )
        }
      >
        {segment.type === 'predicate'
          ? t('segments.detail.actions.editPredicate', { defaultValue: 'Edit predicate' })
          : t('segments.detail.actions.convertToLive', { defaultValue: 'Convert to Live' })}
      </Button>
      {segment.can_administer && (
        <Dropdown
          trigger={['click']}
          placement="bottomRight"
          overlay={
            <Menu>
              <Menu.Item
                key="delete"
                danger
                icon={<Trash2 size={13} aria-hidden />}
                onClick={onDelete}
              >
                {t('segments.actions.delete.menuItem', { defaultValue: 'Delete segment' })}
              </Menu.Item>
            </Menu>
          }
        >
          <Button
            aria-label={t('segments.detail.actions.more', { defaultValue: 'More' })}
            icon={<MoreHorizontal size={15} aria-hidden />}
          />
        </Dropdown>
      )}
    </div>
  );
}
