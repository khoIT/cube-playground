/** Segment detail — header, KPI strip, 5-tab strip (Members first, Insights default), tab bodies. */

import { ReactElement, useEffect, useState, ReactNode } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Activity, ChevronDown, Code2, GitBranch, HeartPulse, LineChart, Send, Users } from 'lucide-react';
import { useTopbarBreadcrumbOverride } from '../../../shell/topbar/topbar-breadcrumb-context';
import { pushRecent, removeRecent } from '../../../shell/sidebar/recent-items-store';
import { invalidateSegmentIds } from '../use-segment-ids';
import type { Segment } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { MonitorTab } from './tabs/monitor-tab';
import { InsightsTab } from './tabs/insights-tab';
import { MembersTab } from './tabs/members-tab';
import { CareTab } from './tabs/care-tab';
import { DefinitionTab } from './tabs/definition-tab';
import { PullApiTab } from './tabs/pull-api-tab';
import { FunnelDetailTab } from './tabs/funnel-detail-tab';
import { ConfirmDestructiveModal } from '../components/confirm-destructive-modal';
import { hasCsCoverage } from '../../../api/segment-cs-care';
import { usePreset } from './use-preset';
import { useActiveTab, DetailTabId } from './use-active-tab';
import { useSegmentLivePolling } from './hooks/use-segment-live-polling';
import { useSegmentSizeDelta } from './hooks/use-segment-size-delta';
import { format as formatDate, addMinutes } from 'date-fns';
import { DetailHeaderActions } from './components/detail-header-actions';
import { EditableSegmentTitle } from './components/editable-segment-title';
import { AiBriefCard } from './components/ai-brief-card';
import { BrokenSegmentBanner } from './components/broken-segment-banner';
import { ActivationChip } from './components/activation-chip';
import { HeadlineStatsRow } from './components/headline-stats-row';
import { useHeadlineDeltas } from './components/use-headline-deltas';
import { formatCompact } from './cards/format-value';
import { SegmentScopeBar } from './components/segment-scope-bar';
import { SegmentScopeProvider } from './segment-scope-context';
import { SegmentHealthPill } from '../status/segment-health-pill';
import styles from '../segments.module.css';

const BASE_TABS: DetailTabId[] = ['members', 'insights', 'monitor', 'definition', 'activation'];

const TAB_ICONS: Record<DetailTabId, ReactNode> = {
  monitor: <Activity size={14} aria-hidden />,
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Collapse the frozen summary (KPI cards + AI brief) to hand the viewport to
  // the table below. Persisted so it sticks across segments/sessions; collapsed
  // still shows a condensed KPI strip, so no numbers are lost.
  const [summaryCollapsed, setSummaryCollapsed] = useState(
    () => localStorage.getItem('segments:detailSummaryCollapsed') === '1',
  );
  const toggleSummary = (): void => {
    setSummaryCollapsed((c) => {
      const next = !c;
      localStorage.setItem('segments:detailSummaryCollapsed', next ? '1' : '0');
      return next;
    });
  };

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
  // Per-card vs-yesterday movement (from daily snapshots) — merged onto the
  // headline strip so the Monitor tab no longer needs a duplicate KPI row.
  const headlineDeltas = useHeadlineDeltas(segment, preset);

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
  // slotted next to Members (it's a member-centric CS overlay). Movement was
  // merged into Monitor (the single "Now → Over time" surface), so there is no
  // separate Movement tab. Funnel tab is appended when the segment was created
  // via the funnel builder.
  const showCare = segment.type === 'predicate' && hasCsCoverage(segment.game_id);
  const baseTabs: DetailTabId[] = BASE_TABS.flatMap((tid) => {
    if (tid === 'members' && showCare) return [tid, 'care' as DetailTabId];
    return [tid];
  });
  const tabs: DetailTabId[] = segment.funnel_json ? [...baseTabs, 'funnel'] : baseTabs;

  const lastRefresh = segment.last_refreshed_at ?? segment.updated_at;
  const goActivation = () => setTab('activation');

  // The "paying users only" sub-scope is offered only for cubes that model a
  // lifetime-paying segment — today the mf_users hub. Gates both the scope bar
  // and (via the provider) whether a `?scope=paying` deep-link takes effect.
  const scopeAvailable = preset?.hubCube === 'mf_users';

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
    <SegmentScopeProvider available={scopeAvailable}>
    <main className={styles.page}>
      <div className={styles.detailStickyHeader}>
      <BrokenSegmentBanner segment={segment} onViewRefreshLog={() => setTab('monitor')} />
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <button
            type="button"
            className={styles.summaryCollapseBtn}
            data-collapsed={summaryCollapsed ? 'true' : undefined}
            aria-expanded={!summaryCollapsed}
            aria-label={summaryCollapsed ? 'Expand summary' : 'Collapse summary'}
            title={summaryCollapsed ? 'Expand summary' : 'Collapse summary — more room for the table'}
            onClick={toggleSummary}
          >
            <ChevronDown size={15} aria-hidden />
          </button>
          <EditableSegmentTitle segment={segment} onRename={setSegment} />
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
          {scopeAvailable && preset && <SegmentScopeBar segment={segment} preset={preset} compact />}
          <DetailHeaderActions
            segment={segment}
            preset={preset}
            onSegmentChange={setSegment}
            onDelete={() => setDeleteOpen(true)}
          />
        </div>
      </header>

      {/* Headline KPIs — full cards when expanded, condensed inline strip when
          collapsed (same values, one fetch). AI brief hides on collapse. */}
      <HeadlineStatsRow
        segment={segment}
        preset={preset}
        deltas={headlineDeltas}
        refreshLog={sizeDelta.rows}
        lastRefresh={lastRefresh}
        lastRefreshFooter={lastRefreshFooter}
        ownerFooter={ownerFooter}
        collapsed={summaryCollapsed}
      />

      {!summaryCollapsed && <AiBriefCard segmentId={segment.id} />}

      <div className={styles.tabStrip} role="tablist">
        {tabs.map((tid) => {
          const isMembers = tid === 'members';
          return (
            <button
              key={tid}
              type="button"
              role="tab"
              aria-selected={tab === tid}
              className={[
                styles.tab,
                tab === tid ? styles.tabActive : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setTab(tid)}
            >
              {TAB_ICONS[tid]}
              {t(`segments.detail.tabs.${tid}`, { defaultValue: tid })}
              {isMembers && (
                <span className={styles.tabBadge}>{formatCompact(segment.uid_count)}</span>
              )}
            </button>
          );
        })}
      </div>
      </div>

      {tab === 'monitor' && <MonitorTab segment={segment} />}
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
        <PullApiTab segment={segment} identityDim={preset?.identityDim ?? null} onSegmentChange={setSegment} />
      )}

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
    </SegmentScopeProvider>
  );
}
