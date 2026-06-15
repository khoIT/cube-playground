/**
 * CachedResponseBadge — subtle indicator next to the assistant header timestamp
 * marking that a turn was served from the response cache rather than a live LLM
 * call. Mirrors how tool calls and reasoning traces signal non-default paths.
 *
 *   ⚡ cached            — payload + chart data served verbatim from cache
 *   ⚡ cached · refreshed — chart data re-executed against live Cube on replay
 *
 * Click → opens the source playground/chat thread (future). For now, hover
 * tooltip explains the state.
 */
import React from 'react';
import { Zap } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';

interface CachedResponseBadgeProps {
  freshness: 'refreshed' | 'stale' | null | undefined;
}

export function CachedResponseBadge({ freshness }: CachedResponseBadgeProps) {
  const refreshed = freshness === 'refreshed';
  const label = refreshed ? 'cached · refreshed' : 'cached';
  const title = refreshed
    ? 'Served from response cache; chart data re-executed against live Cube on replay.'
    : 'Served from response cache. Open any query card to query live data.';

  return (
    <span
      role="status"
      aria-label={`Response ${label}`}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontFamily: T.fSans,
        fontSize: 11,
        color: 'var(--shell-text-subtle)',
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon icon={Zap} size={11} color={refreshed ? 'var(--shell-success)' : 'var(--shell-text-subtle)'} />
      <span>{label}</span>
    </span>
  );
}
