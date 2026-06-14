/**
 * Care tab — embeds the VIP-care playbook monitor via the shared CareMonitorBody
 * (same body that renders on /dashboards/cs, so behaviour is identical with no
 * re-composition drift).
 *
 * The care hooks are NOT deduped, so this tab owns its own fetch — but the Ops
 * page unmounts the inactive tab, so the body (and CsActivityStrip's 30s poll
 * inside it) only runs while the Care tab is the active one.
 */
import React from 'react';
import { useAuthUser } from '../../auth/auth-context';
import { useCarePlaybooks } from '../Dashboards/cs/use-care-playbooks';
import { useCareDataFreshness } from '../Dashboards/cs/use-care-data-freshness';
import { CareMonitorBody } from '../Dashboards/cs/care-monitor-body';

interface CareTabProps {
  gameId: string;
}

export function CareTab({ gameId }: CareTabProps) {
  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';
  const care = useCarePlaybooks(gameId);
  const { asOfByCube } = useCareDataFreshness(gameId);

  return (
    <CareMonitorBody gameId={gameId} care={care} asOfByCube={asOfByCube} canWrite={canWrite} />
  );
}
