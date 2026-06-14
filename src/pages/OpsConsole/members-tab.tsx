/**
 * Members tab — a ranked top-payers table over a uid search box.
 *
 * Both entry points open the same already-routable standalone member360:
 *   /dashboards/cs/members/:uid?game=<gameId>
 * (Member360View is propless + route-coupled, so it can't be embedded without a
 * refactor.) uids may be vopenid (contain '@') — encode the route param;
 * member-360-view decodeURIComponent's it back before the Cube filter. The table
 * and the search share one openMember360 helper so the navigation never drifts.
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import { UserSearch, ArrowRight } from 'lucide-react';
import { MembersTopPayers } from './members-top-payers';

interface MembersTabProps {
  gameId: string;
}

export function MembersTab({ gameId }: MembersTabProps) {
  const history = useHistory();
  const [uid, setUid] = React.useState('');

  const openMember360 = React.useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      history.push(
        `/dashboards/cs/members/${encodeURIComponent(trimmed)}?game=${encodeURIComponent(gameId)}`,
      );
    },
    [history, gameId],
  );

  const canOpen = uid.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: 'var(--font-sans)' }}>
      {/* Header row: description + uid search (kept) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserSearch size={18} color="var(--brand)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            Top payers by lifetime value
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· click a row to open the member 360</span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            openMember360(uid);
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            type="text"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            placeholder="uid or vopenid…"
            aria-label="Player uid"
            style={{
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: 'var(--font-sans)',
              color: 'var(--text-primary)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              outline: 'none',
              width: 240,
            }}
          />
          <button
            type="submit"
            disabled={!canOpen}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: canOpen ? 'var(--brand)' : 'var(--bg-muted)',
              color: canOpen ? 'var(--text-on-brand)' : 'var(--text-muted)',
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

      <MembersTopPayers gameId={gameId} onOpen={openMember360} />
    </div>
  );
}
