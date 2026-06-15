/**
 * SessionRowMenu — kebab (3-dot) menu orchestrator for a session row.
 * Delegates rendering to subcomponents; owns state + API calls only.
 */
import React, { useRef, useState, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';
import { T } from '../../../shell/theme';
import type { SessionSummary } from '../hooks/use-chat-sessions-list';
import { SessionRowRenameInline } from './session-row-rename-inline';
import { SessionRowDeleteConfirm } from './session-row-delete-confirm';
import { SessionRowMenuDropdown } from './session-row-menu-dropdown';
import { chatHeaders } from '../../../api/chat-auth-headers';

interface SessionRowMenuProps {
  session: SessionSummary;
  onRenamed: (newTitle: string) => void;
  onDeleted: () => void;
}

type MenuState = 'closed' | 'open' | 'renaming' | 'confirming-delete';

export function SessionRowMenu({ session, onRenamed, onDeleted }: SessionRowMenuProps) {
  const [menuState, setMenuState] = useState<MenuState>('closed');
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    if (menuState !== 'open' && menuState !== 'confirming-delete') return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuState('closed');
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuState]);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuState((s) => (s === 'open' ? 'closed' : 'open'));
  }

  function startRename(e: React.MouseEvent) {
    e.stopPropagation();
    setRenameValue(session.title || '');
    setMenuState('renaming');
  }

  function startDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuState('confirming-delete');
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === session.title) { setMenuState('closed'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/sessions/${session.id}`, {
        method: 'PATCH',
        headers: chatHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) onRenamed(trimmed);
    } finally {
      setBusy(false);
      setMenuState('closed');
    }
  }

  async function confirmDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/sessions/${session.id}`, {
        method: 'DELETE',
        headers: chatHeaders(),
      });
      if (res.ok) onDeleted();
    } finally {
      setBusy(false);
      setMenuState('closed');
    }
  }

  function cancelAction(e?: React.MouseEvent) {
    e?.stopPropagation();
    setMenuState('closed');
  }

  if (menuState === 'renaming') {
    return (
      <SessionRowRenameInline
        value={renameValue}
        busy={busy}
        onChange={setRenameValue}
        onCommit={commitRename}
        onCancel={() => cancelAction()}
      />
    );
  }

  if (menuState === 'confirming-delete') {
    return (
      <SessionRowDeleteConfirm
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={cancelAction}
      />
    );
  }

  return (
    <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        data-testid="session-row-menu"
        onClick={openMenu}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          border: 'none',
          borderRadius: 4,
          background: 'none',
          cursor: 'pointer',
          color: 'var(--shell-text-subtle)',
          padding: 0,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-subtle)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
      >
        <MoreVertical size={14} />
      </button>

      {menuState === 'open' && (
        <SessionRowMenuDropdown onRename={startRename} onDelete={startDelete} />
      )}
    </div>
  );
}
