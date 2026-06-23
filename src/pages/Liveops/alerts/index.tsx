/**
 * AlertsPage — /liveops/alerts
 *
 * The alerting home: Inbox (the existing anomaly archive), Alert rules, and
 * Digests & schedule. The Inbox tab renders the production anomaly inbox as-is
 * (it brings its own header); Rules / Digests are scaffolded here and filled in a
 * later build step. The /liveops/anomalies route redirects here with ?tab=inbox,
 * preserving any metric/severity deep-link params.
 */
import React from 'react';
import { Inbox, BellRing, CalendarClock } from 'lucide-react';
import { LiveopsTabs, type LiveopsHubTab } from '../_hub/liveops-tabs';
import { useLiveopsTab } from '../_hub/use-liveops-tab';
import { AnomalyInboxPage } from '../anomaly-inbox';
import { AlertRulesTab } from './alert-rules-tab';
import { DigestsTab } from './digests-tab';

type AlertsTab = 'inbox' | 'rules' | 'digests';

const TABS: LiveopsHubTab<AlertsTab>[] = [
  { id: 'inbox', label: 'Anomaly inbox', icon: Inbox },
  { id: 'rules', label: 'Alert rules', icon: BellRing },
  { id: 'digests', label: 'Digests & schedule', icon: CalendarClock },
];
const TAB_IDS: readonly AlertsTab[] = ['inbox', 'rules', 'digests'];

const tabBarWrap: React.CSSProperties = {
  padding: '24px 32px 0',
  maxWidth: 1100,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

const bodyWrap: React.CSSProperties = {
  padding: '20px 32px 32px',
  maxWidth: 1100,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

export function AlertsPage() {
  const [active, setActive] = useLiveopsTab(TAB_IDS, 'inbox');

  return (
    <div>
      <div style={tabBarWrap}>
        <LiveopsTabs tabs={TABS} active={active} onChange={setActive} ariaLabel="Alerts sections" />
      </div>

      {/* Inbox: production anomaly archive with its own page header. */}
      {active === 'inbox' && <AnomalyInboxPage />}

      {/* Alert rules: threshold/condition engine + rule builder. */}
      {active === 'rules' && (
        <div style={bodyWrap}>
          <AlertRulesTab />
        </div>
      )}

      {/* Digests: subscription manager + scheduled in-app delivery. */}
      {active === 'digests' && (
        <div style={bodyWrap}>
          <DigestsTab />
        </div>
      )}
    </div>
  );
}
