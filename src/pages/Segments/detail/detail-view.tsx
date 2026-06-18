/** Segment detail — header, KPI strip, 5-tab strip (Members first, Insights default), tab bodies. */

import { ReactElement, useEffect, useState, ReactNode } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Activity, Code2, GitBranch, HeartPulse, LineChart, Send, Users, Waypoints } from 'lucide-react';
import { useTopbarBreadcrumbOverride } from '../../../shell/topbar/topbar-breadcrumb-context';
import { pushRecent, removeRecent } from '../../../shell/sidebar/recent-items-store';
import { invalidateSegmentIds } from '../use-segment-ids';
import type { Segment } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { MonitorTab } from './tabs/monitor-tab';
import { MovementTab } from './tabs/movement-tab';
import { InsightsTab } from './tabs/insights-tab';
import { MembersTab } from './tabs/members-tab';
import { CareTab } from './tabs/care-tab';
import { DefinitionTab } from './tabs/definition-tab';
import { PullApiTab } from './tabs/pull-api-tab';
import { FunnelDetailTab } from './tabs/funnel-detail-tab';
import { ActivateToCdpModal } from '../push-modal/activate-to-cdp-modal';
import { ConfirmDestructiveModal } from '../components/confirm-destructive-modal';
import { hasCsCoverage } from '../../../api/segment-cs-care';
import { usePreset } from './use-preset';
import { useActiveTab, DetailTabId } from './use-active-tab';
import { useSegmentLivePolling } from './hooks/use-segment-live-polling';
import { useSegmentSizeDelta } from './hooks/use-segment-size-delta';
import { format as formatDate, addMinutes } from 'date-fns';
import { DetailHeaderActions } from './components/detail-header-actions';
import { AiBriefCard } from './components/ai-brief-card';
import { BrokenSegmentBanner } from './components/broken-segment-banner';
import { ActivationChip } from './components/activation-chip';
import { HeadlineStatsRow } from './components/headline-stats-row';
import { SegmentHealthPill } from '../status/segment-health-pill';
import styles from '../segments.module.css';

const BASE_TABS: DetailTabId[] = ['members', 'insights', 'monitor', 'definition', 'activation'];

const TAB_ICONS: Record<DetailTabId, ReactNode> = {
  monitor: <Activity size={14} aria-hidden />,
  movement: <Waypoints size={14} aria-hidden />,
  insights: <LineChart size={14} aria-hidden />,
  members: <Users size={14} aria-hidden />,
  care: <HeartPulse size={14} aria-hidden />,
  definition: <Code2 size={14} aria-hidden />,
  activation: <Send size={14} aria-hidden />,
  funnel: <GitBranch size={14} aria-hidden />,
};

export function DetailView(): ReactElement {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const history = useHistory();
  const [segment, setSegment] = useState<Segment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preset = usePreset(segment);
  const { tab, section, setTab, setSection } = useActiveTab();
  const [activateOpen, setActivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSegment(null);
    setError(null);
    segmentsClient
      .get(id)
      .then((row) => {
        if (!cancelled) setSegment(row);
      })
      .catch((err: SegmentApiError) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useSegmentLivePolling(
    segment?.id ?? null,
    (next) => setSegment(next),
    { enabled: segment?.type === 'predicate' },
  );

  // Once the segment loads, push it into the sidebar's "recently viewed" tray
  // under Segments using the real display name. Routed here (not in
  // App.tsx) because that path-level pusher only sees the UUID in the URL.
  useEffect(() => {
    if (!segment) return;
    pushRecent('segments', {
      id: segment.id,
      title: segment.name,
      updatedAt: new Date().toISOString(),
    });
  }, [segment?.id, segment?.name]);

  // Swap the topbar breadcrumb tail (UUID → real segment name).
  useTopbarBreadcrumbOverride(segment?.name ?? null, [segment?.id, segment?.name]);

  const sizeDelta = useSegmentSizeDelta(segment?.id ?? null, segment?.uid_count ?? null, 7);

  if (error) {
    return (
      <main className={styles.page}>
        <div className={styles.errorState}>{error}</div>
      </main>
    );
  }
  if (segment == null) {
    return (
      <main className={styles.page}>
        <div className={styles.skeletonRow} style={{ width: 240, height: 28 }} />
        <div className={styles.skeletonRow} style={{ height: 48, marginTop: 8 }} />
      </main>
    );
  }

  // Care tab only for predicate segments of games wired to the CS warehouse —
  // slotted next to Members (it's a member-centric CS overlay). Movement (beta)
  // sits next to Monitor for predicate+game segments (it reads the lakehouse
  // snapshot history). Funnel tab is appended when the segment was created via
  // the funnel builder.
  const showCare = segment.type === 'predicate' && hasCsCoverage(segment.game_id);
  const showMovement = segment.type === 'predicate' && Boolean(segment.game_id);
  const baseTabs: DetailTabId[] = BASE_TABS.flatMap((tid) => {
    if (tid === 'members' && showCare) return [tid, 'care' as DetailTabId];
    if (tid === 'monitor' && showMovement) return [tid, 'movement' as DetailTabId];
    return [tid];
  });
  const tabs: DetailTabId[] = segment.funnel_json ? [...baseTabs, 'funnel'] : baseTabs;

  const lastRefresh = segment.last_refreshed_at ?? segment.updated_at;
  const goActivation = () => setTab('activation');
  const openActivateModal = () => setActivateOpen(true);

  const sizeTone: 'positive' | 'negative' | null = sizeDelta.percent == null
    ? null
    : sizeDelta.percent >= 0
      ? 'positive'
      : 'negative';
  const sizeComparison = sizeDelta.percent != null && sizeTone != null
    ? {
        text: `${sizeDelta.percent >= 0 ? '↑' : '↓'} ${Math.abs(sizeDelta.percent).toFixed(1)}% ${t('segments.detail.kpi.vsLastWeek', { defaultValue: 'vs last week' })}`,
        tone: sizeTone,
      }
    : null;

  const nextRefreshAt =
    segment.type === 'predicate' && lastRefresh && segment.refresh_cadence_min
      ? formatDate(addMinutes(new Date(lastRefresh), segment.refresh_cadence_min), 'HH:mm')
      : null;
  const lastRefreshFooter = nextRefreshAt
    ? t('segments.detail.kpi.nextAt', { defaultValue: 'next at {{at}}', at: nextRefreshAt })
    : null;

  const ownerFooter = segment.created_at
    ? t('segments.detail.kpi.createdOn', {
        defaultValue: 'created {{date}}',
        date: formatDate(new Date(segment.created_at), 'd MMM'),
      })
    : null;

  return (
    <main className={styles.page}>
      <div className={styles.detailStickyHeader}>
      <BrokenSegmentBanner segment={segment} onViewRefreshLog={() => setTab('monitor')} />
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <h1 className={styles.detailTitle}>{segment.name}</h1>
          {segment.cube != null && (
            <span className={styles.cubeBadge}>{segment.cube}</span>
          )}
          {preset?.auto && (
            <span
              className={styles.autoPresetChip}
              title={t('segments.detail.autoPreset.chipTooltip', {
                defaultValue: 'Insights and member columns are auto-generated from Cube metadata.',
              })}
            >
              {t('segments.detail.autoPreset.chip', { defaultValue: 'Auto preset' })}
            </span>
          )}
          {preset?.pivotedFromCube && (
            <span
              className={styles.autoPresetChip}
              title={t('segments.detail.pivotPreset.chipTooltip', {
                defaultValue: `Insights reuse the ${preset.hubCube} preset — this cube's members are identified through it via the Cube join path.`,
              })}
            >
              {t('segments.detail.pivotPreset.chip', { defaultValue: `via ${preset.hubCube}` })}
            </span>
          )}
          <SegmentHealthPill segment={segment} onCadenceChange={setSegment} />
          <ActivationChip segment={segment} onJump={goActivation} />
          <div style={{ flex: 1 }} />
          <DetailHeaderActions
            segment={segment}
            preset={preset}
            onSegmentChange={setSegment}
            onDelete={() => setDeleteOpen(true)}
          />
        </div>
      </header>

      <HeadlineStatsRow
        segment={segment}
        preset={preset}
        sizeComparison={sizeComparison}
        refreshLog={sizeDelta.rows}
        lastRefresh={lastRefresh}
        lastRefreshFooter={lastRefreshFooter}
        ownerFooter={ownerFooter}
      />

      <AiBriefCard segmentId={segment.id} />

      <div className={styles.tabStrip} role="tablist">
        {tabs.map((tid) => (
          <button
            key={tid}
            type="button"
            role="tab"
            aria-selected={tab === tid}
            className={[styles.tab, tab === tid ? styles.tabActive : ''].filter(Boolean).join(' ')}
            onClick={() => setTab(tid)}
          >
            {TAB_ICONS[tid]}
            {t(`segments.detail.tabs.${tid}`, { defaultValue: tid })}
            {tid === 'movement' && (
              <span
                style={{
                  marginLeft: 4,
                  background: 'var(--info-soft)',
                  color: 'var(--info-ink)',
                  borderRadius: 'var(--radius-full)',
                  padding: '0 5px',
                  fontSize: 8.5,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                BETA
              </span>
            )}
          </button>
        ))}
      </div>
      </div>

      {tab === 'monitor' && (
        <MonitorTab
          segment={segment}
          onActivate={openActivateModal}
          onJumpToActivation={goActivation}
          onCadenceChange={setSegment}
        />
      )}
      {tab === 'movement' && <MovementTab segment={segment} onSegmentChange={setSegment} />}
      {tab === 'insights' && (
        <InsightsTab
          segment={segment}
          preset={preset}
          section={section}
          onSectionChange={setSection}
        />
      )}
      {tab === 'members' && <MembersTab segment={segment} preset={preset} />}
      {tab === 'care' && <CareTab segment={segment} />}
      {tab === 'definition' && <DefinitionTab segment={segment} preset={preset} />}
      {tab === 'funnel' && segment.funnel_json && (
        <FunnelDetailTab funnelJson={segment.funnel_json} />
      )}
      {tab === 'activation' && (
        <PullApiTab segment={segment} identityDim={preset?.identityDim ?? null} />
      )}

      <ActivateToCdpModal
        open={activateOpen}
        segment={segment}
        identityField={preset?.identityDim ?? null}
        onClose={() => setActivateOpen(false)}
        onActivated={(updated) => {
          setSegment(updated);
          setTab('activation');
        }}
      />

      <ConfirmDestructiveModal
        open={deleteOpen}
        title={t('segments.actions.delete.title', { defaultValue: 'Delete segment?' })}
        body={t('segments.actions.delete.body', {
          defaultValue:
            'This permanently removes “{{name}}” along with its tags, activations, refresh log, and pinned analyses. This cannot be undone.',
          name: segment.name,
        })}
        expectedText={segment.name}
        okText={t('segments.actions.delete.ok', { defaultValue: 'Delete segment' })}
        onConfirm={async () => {
          try {
            await segmentsClient.delete(segment.id);
            removeRecent('segments', segment.id);
            invalidateSegmentIds();
            message.success(
              t('segments.actions.delete.success', {
                defaultValue: 'Deleted “{{name}}”',
                name: segment.name,
              }),
            );
            setDeleteOpen(false);
            history.push('/segments');
          } catch (err) {
            const reason =
              err instanceof SegmentApiError ? err.message : 'Failed to delete segment';
            message.error(reason);
          }
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </main>
  );
}
