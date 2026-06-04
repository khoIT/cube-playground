/**
 * Collapsible "Behavior" section — the lazy, ≤31d-bounded FPS event panels.
 *
 * Event tables sit over 1M–1.3B-row `etl_*` cubes, so nothing here queries
 * until the section is expanded. On expand it resolves the playerid bridge once
 * (the user's `role_id`s via `user_roles_panel`), then renders each event panel:
 * playerid-keyed panels filter `playerid IN role_ids`; login/logout filter
 * `clientsdkuserid = user_id`. A user with 0 roles → playerid panels show an
 * empty state (not an error); session panels still work.
 */

import { ReactElement, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Activity } from 'lucide-react';
import type { Member360Panel } from './member360-panels';
import { MemberPanel } from './member-panel';
import { BehaviorDateRange, rangeForDays } from './behavior-date-range';
import { useMemberCubeQuery } from './use-member-cube-query';
import type { Query } from '@cubejs-client/core';

interface Props {
  gameId: string | null;
  uid: string;
  panels: Member360Panel[];
}

export function BehaviorSection({ gameId, uid, panels }: Props): ReactElement | null {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [rangeId, setRangeId] = useState('last_30d');
  const [range, setRange] = useState(() => rangeForDays(30));

  // Resolve the user's role_ids once, only after expand (playerid bridge).
  const rolesQuery = useMemo<Query | null>(
    () =>
      expanded
        ? {
            dimensions: ['user_roles_panel.role_id'],
            filters: [
              { member: 'user_roles_panel.user_id', operator: 'equals' as never, values: [uid] },
            ],
            limit: 500,
          }
        : null,
    [expanded, uid],
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

  if (panels.length === 0) return null;

  return (
    <section style={{ marginTop: 8 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 4px',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <Activity size={15} aria-hidden style={{ color: 'var(--brand)' }} />
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {t('segments.member360.behaviorTitle', { defaultValue: 'Behavior' })}
        </h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t('segments.member360.behaviorHint', {
            defaultValue: '{{n}} event streams · loads on expand · ≤31d',
            n: panels.length,
          })}
        </span>
        {expanded && (
          <div style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <BehaviorDateRange
              activeId={rangeId}
              onChange={(id, r) => {
                setRangeId(id);
                setRange(r);
              }}
            />
          </div>
        )}
      </header>

      {expanded && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
          {panels.map((p) => {
            const playeridKeyed = p.identityKey === 'playerid';
            const idValues = playeridKeyed ? roleIds : [uid];
            // Hold playerid panels until the bridge resolves so they don't flash
            // an empty state before role_ids arrive.
            const idle = playeridKeyed && rolesLoading;
            return (
              <MemberPanel
                key={p.id}
                gameId={gameId}
                panel={p}
                idValues={idValues}
                dateRange={range}
                idle={idle}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
