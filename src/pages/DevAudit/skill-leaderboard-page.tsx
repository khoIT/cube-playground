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
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useSkillLeaderboard } from './use-skill-leaderboard';
import { SkillLeaderboardTable } from './skill-leaderboard-table';

const DAY_OPTIONS = [7, 30, 90] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

const S = {
  root: {
    flex: 1,
    overflow: 'auto',
    padding: 16,
    fontFamily: T.fSans,
    background: T.surface,
  } as React.CSSProperties,
  filter: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    marginBottom: 16,
    fontSize: 11,
    color: T.n500,
  } as React.CSSProperties,
  select: {
    padding: '3px 8px',
    border: `1px solid ${T.n300}`,
    borderRadius: 4,
    fontSize: 12,
    fontFamily: T.fSans,
    background: T.surface,
    color: T.n800,
    cursor: 'pointer',
  } as React.CSSProperties,
  meta: {
    fontSize: 10.5,
    color: T.n500,
    fontFamily: T.fMono,
    marginBottom: 12,
  } as React.CSSProperties,
  error: {
    padding: 16,
    color: '#c00',
    fontSize: 13,
  } as React.CSSProperties,
  spinner: {
    padding: 24,
    color: T.n400,
    fontSize: 13,
  } as React.CSSProperties,
};

export function SkillLeaderboardPage() {
  const activeGameId = useActiveGameId();
  // Default 30d — matches phase spec; game default is "All games" (activeGameId or undefined)
  const [days, setDays] = useState<DayOption>(30);

  const { skills, computedAt, isLoading, error } = useSkillLeaderboard({
    gameId: activeGameId || undefined,
    days,
  });

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

      {isLoading && !error && <div style={S.spinner}>Loading…</div>}

      {!isLoading && !error && <SkillLeaderboardTable rows={skills} />}
    </div>
  );
}
