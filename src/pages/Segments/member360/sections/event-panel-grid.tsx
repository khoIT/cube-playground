/**
 * Grid of event-stream (behavior) panels with the ≤31d date control + playerid
 * bridge. Used inside the Details "Behavior"/"Combat" tabs — the tab selection
 * is the lazy gate (only the active tab mounts this), so the 1M–1.3B-row etl_*
 * cubes are queried only when the user opens that tab.
 *
 * Bridge: resolve the user's role_id`s once (user_roles_panel), then playerid
 * panels filter `playerid IN role_ids`; login/logout filter clientsdkuserid =
 * user_id. 0 roles → playerid panels show an empty state (not an error).
 */

import { ReactElement, useMemo, useState } from 'react';
import type { Query } from '@cubejs-client/core';
import type { Member360Panel } from '../member360-panels';
import { MemberPanel } from '../member-panel';
import { BehaviorDateRange, rangeForDays } from '../behavior-date-range';
import { useMemberCubeQuery } from '../use-member-cube-query';

interface Props {
  gameId: string | null;
  uid: string;
  panels: Member360Panel[];
}

export function EventPanelGrid({ gameId, uid, panels }: Props): ReactElement {
  const [rangeId, setRangeId] = useState('last_30d');
  const [range, setRange] = useState(() => rangeForDays(30));

  const needsBridge = panels.some((p) => p.identityKey === 'playerid');
  const rolesQuery = useMemo<Query | null>(
    () =>
      needsBridge
        ? {
            dimensions: ['user_roles_panel.role_id'],
            filters: [{ member: 'user_roles_panel.user_id', operator: 'equals' as never, values: [uid] }],
            limit: 500,
          }
        : null,
    [needsBridge, uid],
  );
  const { rows: roleRows, loading: rolesLoading } = useMemberCubeQuery<Record<string, unknown>>(
    gameId,
    rolesQuery,
  );
  const roleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of roleRows) {
      const v = r['user_roles_panel.role_id'];
      if (v != null && v !== '') ids.add(String(v));
    }
    return [...ids];
  }, [roleRows]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <BehaviorDateRange
          activeId={rangeId}
          onChange={(id, r) => {
            setRangeId(id);
            setRange(r);
          }}
        />
      </div>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        {panels.map((p) => {
          const playeridKeyed = p.identityKey === 'playerid';
          return (
            <MemberPanel
              key={p.id}
              gameId={gameId}
              panel={p}
              idValues={playeridKeyed ? roleIds : [uid]}
              dateRange={range}
              idle={playeridKeyed && rolesLoading}
            />
          );
        })}
      </div>
    </div>
  );
}
