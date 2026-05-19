/** Segment detail — header, KPI strip, tab strip, tab bodies. */

import { ReactElement, useEffect, useState } from 'react';
import { useParams, useHistory, Link } from 'react-router-dom';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import { Breadcrumbs, KpiTile, LiveBadge } from '../visuals';
import type { Segment } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { SampleUsersTab } from './tabs/sample-users-tab';
import { TabPending } from './tab-pending-placeholder';
import { PresetTab } from './tabs/preset-tab';
import { usePreset } from './use-preset';
import { KpiCard } from './cards/kpi-card';
import { useSegmentLivePolling } from './hooks/use-segment-live-polling';
import { RefreshNowButton } from './components/refresh-now-button';
import { BrokenSegmentBanner } from './components/broken-segment-banner';
import { StatusPill } from '../status/status-pill';
import { SavedAnalysesTab } from './tabs/saved-analyses-tab';
import { buildPlaygroundDeeplink } from '../../../utils/playground-deeplink';
import styles from '../segments.module.css';

type TabId =
  | 'overview'
  | 'engagement'
  | 'monetization'
  | 'retention'
  | 'sample-users'
  | 'saved-analyses'
  | 'predicate';

const TABS: TabId[] = [
  'overview',
  'engagement',
  'monetization',
  'retention',
  'sample-users',
  'saved-analyses',
  'predicate',
];

const TAB_I18N_KEY: Record<TabId, string> = {
  overview: 'overview',
  engagement: 'engagement',
  monetization: 'monetization',
  retention: 'retention',
  'sample-users': 'sampleUsers',
  'saved-analyses': 'savedAnalyses',
  predicate: 'predicate',
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
  const [activeTab, setActiveTab] = useState<TabId>(
    preset ? 'overview' : 'sample-users',
  );

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
          {segment.type === 'predicate' && (
            <LiveBadge intervalMin={segment.refresh_cadence_min ?? undefined} />
          )}
          <StatusPill status={segment.status} reason={segment.broken_reason} />
          <div style={{ flex: 1 }} />
          <div className={styles.actions}>
            <RefreshNowButton segment={segment} />
            <Button>{t('segments.detail.actions.exportIds')}</Button>
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
          </div>
        </div>
      </header>

      <div className={styles.detailKpiStrip}>
        {preset && preset.headlineKpis.length > 0
          ? preset.headlineKpis.map((spec) => (
              <KpiCard key={spec.id} spec={spec} segment={segment} preset={preset} />
            ))
          : (
            <>
              <KpiTile label="Size" value={formatCount(segment.uid_count)} />
              <KpiTile
                label="Last refresh"
                value={
                  lastRefresh
                    ? formatDistanceToNowStrict(new Date(lastRefresh), { addSuffix: true })
                    : '—'
                }
              />
              <KpiTile label="Owner" value={segment.owner} />
              <KpiTile label="Status" value={segment.status} />
            </>
          )}
      </div>

      <div className={styles.tabStrip} role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={[
              styles.tab,
              activeTab === id ? styles.tabActive : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setActiveTab(id)}
          >
            {t(`segments.detail.tabs.${TAB_I18N_KEY[id]}`)}
          </button>
        ))}
      </div>

      {activeTab === 'sample-users' && <SampleUsersTab segment={segment} />}
      {activeTab === 'overview' && (
        preset ? <PresetTab tab={preset.tabs.find((t) => t.id === 'overview')!} segment={segment} preset={preset} /> : <TabPending phase={4} />
      )}
      {activeTab === 'engagement' && (
        preset ? <PresetTab tab={preset.tabs.find((t) => t.id === 'engagement')!} segment={segment} preset={preset} /> : <TabPending phase={4} />
      )}
      {activeTab === 'monetization' && (
        preset ? <PresetTab tab={preset.tabs.find((t) => t.id === 'monetization')!} segment={segment} preset={preset} /> : <TabPending phase={4} />
      )}
      {activeTab === 'retention' && (
        preset ? <PresetTab tab={preset.tabs.find((t) => t.id === 'retention')!} segment={segment} preset={preset} /> : <TabPending phase={4} />
      )}
      {activeTab === 'saved-analyses' && <SavedAnalysesTab segment={segment} />}
      {activeTab === 'predicate' && <TabPending phase={5} />}
    </main>
  );
}
