/** Segment detail — header, KPI strip, 5-tab strip (Monitor default), tab bodies. */

import { ReactElement, useEffect, useState, ReactNode } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Activity, Code2, LineChart, Send, Users } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Breadcrumbs, KpiTile, LiveBadge } from '../visuals';
import type { Segment } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { MonitorTab } from './tabs/monitor-tab';
import { InsightsTab } from './tabs/insights-tab';
import { MembersTab } from './tabs/members-tab';
import { DefinitionTab } from './tabs/definition-tab';
import { ActivationTab } from './tabs/activation-tab';
import { ActivateToCdpModal } from '../push-modal/activate-to-cdp-modal';
import { ConfirmDestructiveModal } from '../components/confirm-destructive-modal';
import { usePreset } from './use-preset';
import { useActiveTab, DetailTabId } from './use-active-tab';
import { KpiCard } from './cards/kpi-card';
import { useSegmentLivePolling } from './hooks/use-segment-live-polling';
import { useSegmentSizeDelta } from './hooks/use-segment-size-delta';
import { format as formatDate, addMinutes } from 'date-fns';
import { RefreshNowButton } from './components/refresh-now-button';
import { BrokenSegmentBanner } from './components/broken-segment-banner';
import { StatusPill } from '../status/status-pill';
import { buildPlaygroundDeeplink } from '../../../utils/playground-deeplink';
import styles from '../segments.module.css';

const TABS: DetailTabId[] = ['monitor', 'insights', 'members', 'definition', 'activation'];

const TAB_ICONS: Record<DetailTabId, ReactNode> = {
  monitor: <Activity size={14} aria-hidden />,
  insights: <LineChart size={14} aria-hidden />,
  members: <Users size={14} aria-hidden />,
  definition: <Code2 size={14} aria-hidden />,
  activation: <Send size={14} aria-hidden />,
};

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

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
        <div className={styles.detailKpiStrip}>
          {[...Array(4)].map((_, i) => (
            <div key={i} className={styles.skeletonRow} style={{ height: 72 }} />
          ))}
        </div>
      </main>
    );
  }

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
      <BrokenSegmentBanner segment={segment} />
      <header className={styles.detailHeader}>
        <Breadcrumbs
          items={[
            { label: t('segments.detail.backToLibrary'), href: '#/segments' },
            { label: segment.name },
          ]}
        />
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
          {segment.type === 'predicate' && (
            <LiveBadge intervalMin={segment.refresh_cadence_min ?? undefined} />
          )}
          <StatusPill status={segment.status} reason={segment.broken_reason} />
          <div style={{ flex: 1 }} />
          <div className={styles.actions}>
            <RefreshNowButton segment={segment} />
            <Button
              onClick={() => {
                const identityDim = preset?.identityDim ?? `${segment.cube ?? ''}.user_id`;
                const out = buildPlaygroundDeeplink({
                  segmentId: segment.id,
                  segmentName: segment.name,
                  identityDim,
                  primaryCube: segment.cube,
                  uids: segment.uid_list ?? [],
                });
                window.location.assign(out.url);
              }}
              disabled={(segment.uid_list ?? []).length === 0}
            >
              {t('segments.detail.actions.copyAsFilter')}
            </Button>
            <Button
              onClick={() => history.push(`/segments/${segment.id}/edit`)}
              disabled={segment.type !== 'predicate'}
            >
              {t('segments.detail.actions.editPredicate')}
            </Button>
            <Button danger onClick={() => setDeleteOpen(true)}>
              {t('segments.actions.delete.menuItem', { defaultValue: 'Delete segment' })}
            </Button>
          </div>
        </div>
      </header>

      <div className={styles.detailKpiStrip}>
        {preset && preset.headlineKpis.length > 0
          ? preset.headlineKpis.map((spec) => (
              <KpiCard
                key={spec.id}
                spec={spec}
                segment={segment}
                preset={preset}
                cacheKey={`kpi:${spec.id}`}
                comparison={spec.id === 'size' ? sizeComparison : null}
              />
            ))
          : (
            <>
              <KpiTile
                label={t('segments.detail.kpi.size', { defaultValue: 'Size' })}
                value={formatCount(segment.uid_count)}
                delta={sizeComparison?.text}
                tone={sizeComparison?.tone ?? 'neutral'}
              />
              <KpiTile
                label={t('segments.detail.kpi.lastRefresh', { defaultValue: 'Last refresh' })}
                value={
                  lastRefresh
                    ? formatDistanceToNowStrict(new Date(lastRefresh), { addSuffix: true })
                    : '—'
                }
                footer={lastRefreshFooter}
              />
              <KpiTile
                label={t('segments.detail.kpi.owner', { defaultValue: 'Owner' })}
                value={segment.owner}
                footer={ownerFooter}
              />
              <KpiTile label={t('segments.detail.kpi.status', { defaultValue: 'Status' })} value={segment.status} />
            </>
          )}
      </div>

      <div className={styles.tabStrip} role="tablist">
        {TABS.map((tid) => (
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
          </button>
        ))}
      </div>

      {tab === 'monitor' && (
        <MonitorTab
          segment={segment}
          onActivate={openActivateModal}
          onJumpToActivation={goActivation}
        />
      )}
      {tab === 'insights' && (
        <InsightsTab
          segment={segment}
          preset={preset}
          section={section}
          onSectionChange={setSection}
        />
      )}
      {tab === 'members' && <MembersTab segment={segment} preset={preset} />}
      {tab === 'definition' && <DefinitionTab segment={segment} preset={preset} />}
      {tab === 'activation' && (
        <ActivationTab
          segment={segment}
          onActivate={openActivateModal}
          onDeactivate={async (activationId) => {
            try {
              const updated = await segmentsClient.removeActivation(segment.id, activationId);
              setSegment(updated);
              message.success(
                t('segments.detail.activation.deactivated', { defaultValue: 'Activation removed' }),
              );
            } catch (err) {
              const reason =
                err instanceof SegmentApiError ? err.message : 'Failed to remove activation';
              message.error(reason);
            }
          }}
        />
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
