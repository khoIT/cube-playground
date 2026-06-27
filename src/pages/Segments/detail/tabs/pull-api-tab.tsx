/**
 * Pull API tab — exposes the segment as a versioned, pullable member list a
 * downstream app can read once and store. The endpoint is API-key-secured and
 * serves enriched rows (uid + in-game name + LTV + lifecycle dates) once a
 * refresh has built the ranked snapshot.
 *
 * The tab serves two distinct audiences, so it leads with a persistent contract
 * header (lifecycle + counts + publish/demote) and a job switcher:
 *   • Build   — how a downstream dev pulls it (id, endpoint, pagination, recipes)
 *   • Monitor — how the owner/admin observes it (schedule, tokens, consumption)
 * Monitor is admin-gated (its endpoints are admin-only); non-admins only see
 * Build, so the switcher is hidden for them.
 */

import { ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthUser } from '../../../../auth/auth-context';
import type { Segment } from '../../../../types/segment-api';
import { PullContractHeader } from './pull-api/pull-contract-header';
import { PullJobSwitcher, type PullJob } from './pull-api/pull-job-switcher';
import { BuildModeView } from './pull-api/build-mode-view';
import { MonitorModeView } from './pull-api/monitor-mode-view';

interface Props {
  segment: Segment;
  /** Resolved identity dimension (from the segment's preset). Retained on the
   *  contract for callers; not surfaced in this view. */
  identityDim: string | null;
  /** Lifts the updated segment up after publish/demote so the detail view
   *  re-renders into the new lifecycle state without a reload. */
  onSegmentChange?: (s: Segment) => void;
}

export function PullApiTab({ segment, onSegmentChange }: Props): ReactElement {
  const { t } = useTranslation();
  const isAdmin = useAuthUser()?.role === 'admin';
  const [job, setJob] = useState<PullJob>('build');

  // Monitor's endpoints (consumption / tokens) are admin-only → only admins get
  // the switcher; everyone else stays in Build.
  const showMonitor = isAdmin;
  const activeJob: PullJob = showMonitor ? job : 'build';

  return (
    <section style={{ paddingTop: 0 }}>
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 3px', color: 'var(--text-primary)' }}>
          {t('segments.detail.pullApi.title', { defaultValue: 'Pull API' })}
        </h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, maxWidth: 560 }}>
          {t('segments.detail.pullApi.description', {
            defaultValue:
              'Expose this segment as a member list a downstream app can pull once and store. No push — they read on their schedule.',
          })}
        </p>
      </header>

      <PullContractHeader segment={segment} onSegmentChange={onSegmentChange} />

      {showMonitor && <PullJobSwitcher active={activeJob} onChange={setJob} />}

      {activeJob === 'build' ? <BuildModeView segment={segment} /> : <MonitorModeView segment={segment} />}
    </section>
  );
}
