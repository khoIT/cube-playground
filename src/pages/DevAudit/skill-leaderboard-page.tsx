/**
 * SkillLeaderboardPage — /dev/chat-audit/leaderboard
 *
 * Filter bar: gameId (default = active game), days window (7/30/90, default 30).
 * Renders SkillLeaderboardTable. Links back to /dev/chat-audit.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useSkillLeaderboard } from './use-skill-leaderboard';
import { SkillLeaderboardTable } from './skill-leaderboard-table';

const DAY_OPTIONS = [7, 30, 90] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    fontFamily: T.fSans,
    background: T.surface,
    overflow: 'hidden',
  } as React.CSSProperties,
  banner: {
    flexShrink: 0,
    padding: '6px 16px',
    background: T.surfaceSubtle,
    borderBottom: `1px solid ${T.n200}`,
    fontSize: 11,
    color: T.n600,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  backLink: {
    color: T.brand,
    textDecoration: 'none',
    fontWeight: 500,
    fontSize: 12,
  } as React.CSSProperties,
  label: {
    color: T.n500,
    fontSize: 11,
  } as React.CSSProperties,
  select: {
    padding: '2px 6px',
    border: `1px solid ${T.n300}`,
    borderRadius: 4,
    fontSize: 12,
    fontFamily: T.fSans,
    background: T.surface,
    color: T.n800,
    cursor: 'pointer',
  } as React.CSSProperties,
  gameBadge: {
    marginLeft: 'auto',
    color: T.n500,
    fontFamily: T.fMono,
    fontSize: 11,
  } as React.CSSProperties,
  body: {
    flex: 1,
    overflow: 'auto',
    padding: 16,
  } as React.CSSProperties,
  heading: {
    fontSize: 15,
    fontWeight: 600,
    color: T.n800,
    marginBottom: 12,
    fontFamily: T.fSans,
  } as React.CSSProperties,
  meta: {
    fontSize: 11,
    color: T.n400,
    marginBottom: 12,
    fontFamily: T.fMono,
  } as React.CSSProperties,
  error: {
    padding: 16,
    color: '#c00',
    fontSize: 13,
    fontFamily: T.fSans,
  } as React.CSSProperties,
  spinner: {
    padding: 24,
    color: T.n400,
    fontFamily: T.fSans,
    fontSize: 13,
  } as React.CSSProperties,
};

export function SkillLeaderboardPage() {
  const activeGameId = useActiveGameId();
  const [days, setDays] = useState<DayOption>(30);

  const { skills, computedAt, isLoading, error } = useSkillLeaderboard({
    gameId: activeGameId || undefined,
    days,
  });

  return (
    <div style={S.root}>
      <div style={S.banner}>
        <Link to="/dev/chat-audit" style={S.backLink}>
          ← Chat Audit
        </Link>
        <span style={S.label}>Window:</span>
        <select
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
        <span style={S.gameBadge}>game: {activeGameId || 'all'}</span>
      </div>

      <div style={S.body}>
        <div style={S.heading}>Skill Leaderboard</div>

        {computedAt && (
          <div style={S.meta}>
            Computed at {new Date(computedAt).toLocaleTimeString()} &mdash; {skills.length} skill(s)
          </div>
        )}

        {error && <div style={S.error}>Error: {error}</div>}

        {isLoading && !error && (
          <div style={S.spinner}>Loading…</div>
        )}

        {!isLoading && !error && (
          <SkillLeaderboardTable rows={skills} />
        )}
      </div>
    </div>
  );
}
