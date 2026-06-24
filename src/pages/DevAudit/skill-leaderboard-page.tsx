/**
 * SkillLeaderboardPage — /dev/chat-audit/leaderboard tab content.
 *
 * Designed to mount inside DevAuditShell — no standalone back-link banner.
 * The shell provides the top banner and tab navigation.
 *
 * Filter bar: days window (7/30/90, default 30).
 * Renders SkillLeaderboardTable with per-skill sparkline trend column.
 */

import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useSkillLeaderboard } from './use-skill-leaderboard';
import { SkillLeaderboardTable } from './skill-leaderboard-table';
import { SkelRow } from './skeleton-row';
import { EmptyState } from './empty-state';
import { useAuditBasePath, auditPath } from './audit-base-path';

const DAY_OPTIONS = [7, 30, 90] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

const S = {
  root: {
    flex: 1,
    overflow: 'auto',
    padding: 16,
    fontFamily: T.fSans,
    background: 'var(--surface-raised)',
  } as React.CSSProperties,
  filter: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    marginBottom: 16,
    fontSize: 11,
    color: 'var(--shell-text-subtle)',
  } as React.CSSProperties,
  select: {
    padding: '3px 8px',
    border: `1px solid var(--shell-border-strong)`,
    borderRadius: 4,
    fontSize: 12,
    fontFamily: T.fSans,
    background: 'var(--surface-raised)',
    color: 'var(--shell-text-emphasis)',
    cursor: 'pointer',
  } as React.CSSProperties,
  meta: {
    fontSize: 10.5,
    color: 'var(--shell-text-subtle)',
    fontFamily: T.fMono,
    marginBottom: 12,
  } as React.CSSProperties,
  error: {
    padding: 16,
    color: 'var(--destructive-ink)',
    fontSize: 13,
  } as React.CSSProperties,
  spinner: {
    padding: 24,
    color: 'var(--shell-text-faint)',
    fontSize: 13,
  } as React.CSSProperties,
};

export function SkillLeaderboardPage() {
  const activeGameId = useActiveGameId();
  const history = useHistory();
  const basePath = useAuditBasePath();
  // Default 30d — matches phase spec; game default is "All games" (activeGameId or undefined)
  const [days, setDays] = useState<DayOption>(30);

  const { skills, computedAt, isLoading, error } = useSkillLeaderboard({
    gameId: activeGameId || undefined,
    days,
  });

  /** Navigate to Sessions tab pre-filtered by skill name (cross-tab navigation). */
  function handleSkillClick(skillName: string) {
    history.push(`${auditPath(basePath, 'sessions')}?skill=${encodeURIComponent(skillName)}`);
  }

  return (
    <div style={S.root}>
      <div style={S.filter}>
        <label htmlFor="lb-days-select">Window:</label>
        <select
          id="lb-days-select"
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as DayOption)}
          style={S.select}
          aria-label="Days window"
          data-testid="days-select"
        >
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}d
            </option>
          ))}
        </select>
      </div>

      {computedAt && (
        <div style={S.meta}>
          Computed at {new Date(computedAt).toLocaleTimeString()} &mdash; {skills.length} skill(s)
        </div>
      )}

      {error && <div style={S.error}>Error: {error}</div>}

      {isLoading && !error && (
        <div data-testid="leaderboard-loading">
          {Array.from({ length: 6 }).map((_, i) => <SkelRow key={i} height={38} />)}
        </div>
      )}

      {!isLoading && !error && skills.length === 0 && (
        <EmptyState
          title="No assistant turns in window."
          description="Switch to 90d or post a chat to populate the leaderboard."
          testId="leaderboard-empty-state"
        />
      )}

      {!isLoading && !error && skills.length > 0 && (
        <SkillLeaderboardTable rows={skills} onSkillClick={handleSkillClick} />
      )}
    </div>
  );
}
