/**
 * UserMessage — left-aligned bold heading for user turns.
 *
 * Each user prompt acts as a section header that frames the assistant reply
 * directly beneath it, rather than a chat bubble. `compact` switches between
 * the side-panel size and the full-page size.
 */
import React from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { T } from '../../../shell/theme';

/**
 * Format an ISO timestamp as a relative-then-absolute pair.
 *   display: "5 minutes ago" (browser locale via date-fns)
 *   tooltip: full localized date+time so the user can hover for the exact moment
 */
function formatLocalTimestamp(ts: string): { display: string; title: string } | null {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return {
    display: formatDistanceToNowStrict(d, { addSuffix: true }),
    title: d.toLocaleString(),
  };
}

interface UserMessageProps {
  text: string;
  ts?: string;
  compact?: boolean;
}

function UserMessageImpl({ text, ts, compact }: UserMessageProps) {
  const tsLabel = ts ? formatLocalTimestamp(ts) : null;
  return (
    <div
      style={{
        padding: compact ? '16px 16px 4px' : '24px 24px 8px',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: T.fSans,
          fontSize: compact ? 17 : 22,
          fontWeight: 700,
          lineHeight: 1.3,
          color: 'var(--shell-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </h2>
      {tsLabel && (
        <div
          title={tsLabel.title}
          style={{
            marginTop: 4,
            fontFamily: T.fSans,
            fontSize: 11,
            color: 'var(--shell-text-subtle)',
          }}
        >
          {tsLabel.display}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized so committed user turns don't re-render on every streamed token of
 * the live assistant turn. Props (text/ts/compact) are referentially stable
 * for committed messages, so memo holds — only the live turn re-renders.
 */
export const UserMessage = React.memo(UserMessageImpl);
