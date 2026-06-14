/**
 * Members tab — uid search box that links to the existing member360 route.
 *
 * Member360View is propless and route-coupled (it reads useParams() + ?game= and
 * derives gameId from a fetched segment), so it cannot be embedded without a
 * refactor. Per the 2026-06-14 decision, the Members tab is a uid search that
 * navigates to the already-routable standalone member360:
 *   /dashboards/cs/members/:uid?game=<gameId>
 *
 * uids may be vopenid (contain '@') — encode the route param; member-360-view
 * decodeURIComponent's it back before the Cube filter.
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import { UserSearch, ArrowRight } from 'lucide-react';

interface MembersTabProps {
  gameId: string;
}

export function MembersTab({ gameId }: MembersTabProps) {
  const history = useHistory();
  const [uid, setUid] = React.useState('');

  const trimmed = uid.trim();
  const canOpen = trimmed.length > 0;

  const open = React.useCallback(() => {
    if (!trimmed) return;
    history.push(
      `/dashboards/cs/members/${encodeURIComponent(trimmed)}?game=${encodeURIComponent(gameId)}`,
    );
  }, [history, trimmed, gameId]);

  return (
    <div
      style={{
        maxWidth: 560,
        margin: '8px auto 0',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-sm)',
        padding: 28,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <UserSearch size={20} color="var(--brand)" />
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
          }}
        >
          Open a member 360
        </h2>
      </div>
      <p style={{ margin: '0 0 18px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Enter a player uid to open its full payment + identity profile. Accepts numeric uids and
        vopenid (e.g. <code>12345@vopenid</code>).
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          open();
        }}
        style={{ display: 'flex', gap: 8 }}
      >
        <input
          type="text"
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          placeholder="uid or vopenid…"
          aria-label="Player uid"
          autoFocus
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: 13,
            fontFamily: 'var(--font-sans)',
            color: 'var(--text-primary)',
            background: 'var(--bg-input, var(--bg-card))',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!canOpen}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 16px',
            background: canOpen ? 'var(--brand)' : 'var(--bg-muted)',
            color: canOpen ? '#fff' : 'var(--text-muted)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: canOpen ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-sans)',
            whiteSpace: 'nowrap',
          }}
        >
          Open 360
          <ArrowRight size={14} />
        </button>
      </form>
    </div>
  );
}
