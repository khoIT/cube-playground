/**
 * CrossUserAuditPanel — admin view of ANY user's chat sessions.
 *
 * Authorization boundary: this panel ONLY calls the /api/admin/chat/* routes
 * (not the self-scoped /api/chat/debug/* routes used by DevAuditShell). Every
 * request carries ?email=<targetEmail> so the server resolves the target's
 * Keycloak sub and proxies with THEIR identity — the admin never sees their
 * own chats here. Read-only by design: no cancel/delete/rename operations.
 *
 * Layout mirrors the existing per-user-panel.tsx density:
 *   - Left column: user picker (populated from useAdminUsers)
 *   - Right area: sessions list → session detail drill-down
 *
 * Token constraints: tokens.css CSS variables only — no hex literals, no T.*.
 */

import React, { useState, useEffect } from 'react';
import { useAdminUsers } from '../access/use-admin-access';
// Shared artifacts section from DevAudit — internally styled with hermes T.*
// tokens, which are :root-scoped CSS vars, so it renders correctly here too.
import { TurnArtifactsSection } from '../../DevAudit/turn-artifacts-section';
import {
  fetchAdminChatSessions,
  fetchAdminChatSessionDetail,
  sessionDisplayTitle,
  formatEpochMs,
  type DebugSession,
  type DebugSessionDetail,
} from './cross-user-audit-data';

// ---------------------------------------------------------------------------
// Shared style primitives — tokens.css only
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  overflow: 'hidden',
};

const sectionHead: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--border-card)',
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

const mutedText: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
};

// ---------------------------------------------------------------------------
// InlineError — used for fetch failures; never throws to the tab shell
// ---------------------------------------------------------------------------

function InlineError({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--destructive-soft)',
        color: 'var(--destructive-ink)',
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      Error: {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UserPicker — searchable list of admin users
// ---------------------------------------------------------------------------

interface UserPickerProps {
  selectedEmail: string | null;
  onSelect: (email: string) => void;
}

function UserPicker({ selectedEmail, onSelect }: UserPickerProps) {
  const { users, loading, error } = useAdminUsers();
  const [filter, setFilter] = useState('');

  const filtered = filter.trim()
    ? users.filter((u) => u.email.toLowerCase().includes(filter.toLowerCase()))
    : users;

  return (
    <div style={{ ...card, minWidth: 220, maxWidth: 280, flexShrink: 0 }}>
      <div style={sectionHead}>
        <span>Users</span>
        {loading && <span style={mutedText}>loading…</span>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px' }}>
          <InlineError message={error} />
        </div>
      )}

      {!error && (
        <>
          {/* Filter input */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-card)' }}>
            <input
              type="text"
              placeholder="Filter by email…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '5px 8px',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                color: 'var(--text-primary)',
                background: 'var(--bg-muted)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* User list */}
          <div style={{ overflowY: 'auto', maxHeight: 400 }}>
            {filtered.length === 0 && !loading && (
              <div style={{ padding: '12px 14px', ...mutedText }}>No users found.</div>
            )}
            {filtered.map((u) => {
              const isSelected = u.email === selectedEmail;
              return (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => onSelect(u.email)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 14px',
                    fontSize: 13,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    border: 'none',
                    borderBottom: '1px solid var(--border-card)',
                    background: isSelected ? 'var(--bg-muted)' : 'transparent',
                    color: isSelected ? 'var(--brand)' : 'var(--text-primary)',
                    fontWeight: isSelected ? 600 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.email}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TurnRow — compact read-only row for a single turn in session detail
// ---------------------------------------------------------------------------

interface TurnRowProps {
  turn: DebugSessionDetail['turns'][number];
}

function TurnRow({ turn }: TurnRowProps) {
  // Truncate long text; admins can see role + first 200 chars for triage.
  const preview = turn.text ? turn.text.slice(0, 200) : '(empty)';
  const isUser = turn.role === 'user';

  return (
    <div
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-card)',
        background: isUser ? 'var(--bg-muted)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: 'var(--radius-full)',
            background: isUser ? 'var(--info-soft)' : 'var(--muted-soft)',
            color: isUser ? 'var(--info-ink)' : 'var(--muted-ink)',
            textTransform: 'capitalize',
            flexShrink: 0,
          }}
        >
          {turn.role}
        </span>
        <span style={{ ...eyebrow, fontSize: 10.5 }}>
          {turn.createdAt ? new Date(turn.createdAt).toLocaleString() : '—'}
        </span>
        {turn.model && (
          <span style={{ ...mutedText, fontSize: 11 }}>{turn.model}</span>
        )}
        {/* Auth lane label — non-null only on assistant turns that made an LLM call */}
        {'llmAuthLabel' in turn && (
          <span
            aria-label={`auth lane: ${turn.llmAuthLabel ?? '—'}`}
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              padding: '1px 7px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--muted-soft)',
              color: 'var(--text-muted)',
              flexShrink: 0,
              letterSpacing: '0.02em',
            }}
          >
            {turn.llmAuthLabel ?? '—'}
          </span>
        )}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {preview}
        {turn.text && turn.text.length > 200 && (
          <span style={mutedText}> … ({turn.text.length} chars total)</span>
        )}
      </p>
      {/* Query artifacts emitted by this turn — read-only audit view */}
      {!isUser && (turn.artifacts?.length ?? 0) > 0 && (
        <div style={{ marginTop: 8 }}>
          <TurnArtifactsSection artifacts={turn.artifacts} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionDetail — fetches and renders a single session with its turns
// ---------------------------------------------------------------------------

interface SessionDetailProps {
  sessionId: string;
  email: string;
  onBack: () => void;
}

function SessionDetail({ sessionId, email, onBack }: SessionDetailProps) {
  const [detail, setDetail] = useState<DebugSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoading(true);

    fetchAdminChatSessionDetail(sessionId, email)
      .then((data) => {
        setDetail(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId, email]);

  return (
    <div style={{ ...card, flex: 1, minWidth: 0 }}>
      {/* Header with back navigation */}
      <div
        style={{
          ...sectionHead,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'none',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              padding: '3px 10px',
              fontSize: 12,
              fontFamily: 'var(--font-sans)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
          <span>
            {detail ? sessionDisplayTitle(detail.session) : 'Session detail'}
          </span>
        </div>
        {detail && (
          <span style={mutedText}>
            {detail.turns.length} turn{detail.turns.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Session meta */}
      {detail && (
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-card)',
            display: 'flex',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={eyebrow}>Game</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {detail.session.game_id || '—'}
            </div>
          </div>
          <div>
            <div style={eyebrow}>Started</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {formatEpochMs(detail.session.created_at)}
            </div>
          </div>
          <div>
            <div style={eyebrow}>Status</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {detail.session.status}
            </div>
          </div>
        </div>
      )}

      {/* Body states */}
      <div style={{ padding: loading || error ? '14px' : 0 }}>
        {loading && <div style={mutedText}>Loading turns…</div>}
        {error && <InlineError message={error} />}
      </div>

      {/* Turns list */}
      {detail && detail.turns.length === 0 && (
        <div style={{ padding: '14px', ...mutedText }}>No turns in this session.</div>
      )}
      {detail && detail.turns.map((turn) => (
        <TurnRow key={turn.id} turn={turn} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionsList — sessions for the selected user
// ---------------------------------------------------------------------------

interface SessionsListProps {
  email: string;
  onSessionClick: (id: string) => void;
}

function SessionsList({ email, onSessionClick }: SessionsListProps) {
  const [sessions, setSessions] = useState<DebugSession[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSessions(null);
    setError(null);
    setLoading(true);

    fetchAdminChatSessions({ email })
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [email]);

  return (
    <div style={{ ...card, flex: 1, minWidth: 0 }}>
      <div style={sectionHead}>
        Sessions
        {loading && <span style={mutedText}>loading…</span>}
      </div>

      <div style={{ padding: loading || error ? '14px' : 0 }}>
        {error && <InlineError message={error} />}
      </div>

      {sessions && sessions.length === 0 && (
        <div style={{ padding: '14px', ...mutedText }}>No sessions found for this user.</div>
      )}

      {sessions && sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSessionClick(s.id)}
          style={{
            display: 'flex',
            width: '100%',
            textAlign: 'left',
            padding: '11px 14px',
            borderBottom: '1px solid var(--border-card)',
            background: 'transparent',
            border: 'none',
            borderBottomColor: 'var(--border-card)',
            borderBottomWidth: 1,
            borderBottomStyle: 'solid',
            cursor: 'pointer',
            gap: 12,
            alignItems: 'baseline',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {sessionDisplayTitle(s)}
          </span>
          <span style={{ ...mutedText, flexShrink: 0 }}>
            {s.turn_count ?? 0} turn{(s.turn_count ?? 0) !== 1 ? 's' : ''}
          </span>
          <span style={{ ...mutedText, fontSize: 11, flexShrink: 0 }}>
            {formatEpochMs(s.created_at)}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrossUserAuditPanel — composed panel exported to the hub Dev tab
// ---------------------------------------------------------------------------

export function CrossUserAuditPanel() {
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  function handleUserSelect(email: string) {
    // Reset session selection when switching users so detail doesn't show stale data.
    setSelectedSessionId(null);
    setSelectedEmail(email);
  }

  function handleSessionClick(id: string) {
    setSelectedSessionId(id);
  }

  function handleBackToList() {
    setSelectedSessionId(null);
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        fontFamily: 'var(--font-sans)',
        paddingTop: 16,
      }}
    >
      {/* Left: user picker */}
      <UserPicker selectedEmail={selectedEmail} onSelect={handleUserSelect} />

      {/* Right: content area */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* No user selected — empty state */}
        {!selectedEmail && (
          <div
            style={{
              ...card,
              padding: '48px 32px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 8,
              }}
            >
              Select a user to view their chat sessions
            </div>
            <div style={{ ...mutedText, maxWidth: 400, marginInline: 'auto', lineHeight: 1.6 }}>
              Pick a user from the list on the left. You are viewing this as a cross-user admin
              audit — read-only access only.
            </div>
          </div>
        )}

        {/* User selected — show header note + content */}
        {selectedEmail && (
          <>
            {/* Cross-user admin view header note — makes the authorization scope explicit */}
            <div
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--info-soft)',
                color: 'var(--info-ink)',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Viewing <strong>{selectedEmail}</strong>'s chat audit — read-only
            </div>

            {/* Sessions list or session detail */}
            {selectedSessionId ? (
              <SessionDetail
                sessionId={selectedSessionId}
                email={selectedEmail}
                onBack={handleBackToList}
              />
            ) : (
              <SessionsList
                email={selectedEmail}
                onSessionClick={handleSessionClick}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
