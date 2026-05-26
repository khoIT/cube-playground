/**
 * SessionList — left pane of the /dev/chat-audit triage UI.
 * Renders a searchable list of sessions for the active game.
 * Search is debounced 300ms to avoid hammering the backend.
 *
 * Soft-deleted sessions are visible by default; a toggle hides them.
 * Each deleted row exposes a checkbox so the operator can mass-restore or
 * mass-permanently-delete via the SessionListBulkBar.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { T } from '../../shell/theme';
import { useDebugSessions, DebugSession } from './use-debug-api';
import { SkelRow } from './skeleton-row';
import { EmptyState } from './empty-state';
import { SessionListBulkBar } from './session-list-bulk-bar';
import { SessionListRow } from './session-list-row';
import { runBulkSessionAction, type BulkSessionAction } from './session-list-bulk-actions';

interface SessionListProps {
  gameId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Optional skill filter pre-populated from URL ?skill= param (from Leaderboard row click). */
  skillFilter?: string;
}

const S = {
  root: {
    width: 340,
    minWidth: 280,
    display: 'flex',
    flexDirection: 'column' as const,
    borderRight: `1px solid ${T.n200}`,
    height: '100%',
    overflow: 'hidden',
  } as React.CSSProperties,
  searchWrap: {
    padding: '10px 12px',
    borderBottom: `1px solid ${T.n200}`,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  } as React.CSSProperties,
  searchInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '5px 10px',
    border: `1px solid ${T.n300}`,
    borderRadius: 6,
    fontSize: 12,
    fontFamily: T.fSans,
    outline: 'none',
    background: T.surface,
    color: T.n800,
  } as React.CSSProperties,
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 11,
    color: T.n600,
  } as React.CSSProperties,
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    userSelect: 'none' as const,
  } as React.CSSProperties,
  list: { flex: 1, overflowY: 'auto' as const } as React.CSSProperties,
  errorBanner: {
    margin: '8px 12px',
    padding: '6px 10px',
    background: T.redSoft,
    border: `1px solid ${T.red500}`,
    borderRadius: 5,
    fontSize: 11,
    color: T.red600,
  } as React.CSSProperties,
};

export function SessionList({ gameId, selectedId, onSelect, skillFilter }: SessionListProps) {
  const location = useLocation();
  const urlSkill = new URLSearchParams(location.search).get('skill') ?? '';
  const effectiveSkill = skillFilter ?? urlSkill;

  const [rawQ, setRawQ] = useState(effectiveSkill);
  const [debouncedQ, setDebouncedQ] = useState(effectiveSkill);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showDeleted, setShowDeleted] = useState(true);
  const [selectedDeletedIds, setSelectedDeletedIds] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Sync input when URL skill param changes (e.g. navigating from Leaderboard).
  useEffect(() => {
    if (effectiveSkill && effectiveSkill !== rawQ) {
      setRawQ(effectiveSkill);
      setDebouncedQ(effectiveSkill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSkill]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQ(rawQ), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [rawQ]);

  const { data, isLoading, error } = useDebugSessions({ game: gameId, q: debouncedQ }, refreshTick);
  const allSessions = data ?? [];

  const deletedCount = useMemo(
    () => allSessions.filter((s) => s.deletedAt != null).length,
    [allSessions],
  );
  const visibleSessions = useMemo(
    () => (showDeleted ? allSessions : allSessions.filter((s) => s.deletedAt == null)),
    [allSessions, showDeleted],
  );

  // Drop ids no longer present (after purge / refetch) from selection.
  useEffect(() => {
    setSelectedDeletedIds((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(allSessions.filter((s) => s.deletedAt != null).map((s) => s.id));
      const next = new Set<string>();
      let changed = false;
      prev.forEach((id) => { if (present.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [allSessions]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedDeletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedDeletedIds(new Set()), []);

  const runBulk = useCallback(async (action: BulkSessionAction) => {
    const ids = Array.from(selectedDeletedIds);
    if (ids.length === 0) return;
    if (action === 'purge') {
      const ok = window.confirm(
        `Permanently delete ${ids.length} session${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
      );
      if (!ok) return;
    }
    setBulkBusy(true);
    setBulkError(null);
    try {
      const { ok, failed } = await runBulkSessionAction(ids, action);
      if (failed.length > 0) {
        setBulkError(
          `${ok} ${action === 'restore' ? 'restored' : 'purged'}, ${failed.length} failed: ${failed[0].message}`,
        );
      }
      clearSelection();
      setRefreshTick((t) => t + 1);
    } finally {
      setBulkBusy(false);
    }
  }, [selectedDeletedIds, clearSelection]);

  return (
    <div style={S.root}>
      <div style={S.searchWrap}>
        <input
          type="search"
          placeholder="Search sessions…"
          value={rawQ}
          onChange={(e) => setRawQ(e.target.value)}
          style={S.searchInput}
        />
        <div style={S.toggleRow}>
          <label style={S.toggleLabel}>
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => {
                setShowDeleted(e.target.checked);
                if (!e.target.checked) clearSelection();
              }}
              data-testid="toggle-show-deleted"
            />
            <span>Show deleted{deletedCount > 0 ? ` (${deletedCount})` : ''}</span>
          </label>
        </div>
      </div>

      {selectedDeletedIds.size > 0 && (
        <SessionListBulkBar
          selectedCount={selectedDeletedIds.size}
          isBusy={bulkBusy}
          error={bulkError}
          onRestore={() => runBulk('restore')}
          onPurge={() => runBulk('purge')}
          onClear={clearSelection}
        />
      )}

      {error && <div style={S.errorBanner}>Error: {error}</div>}

      <div style={S.list}>
        {isLoading && Array.from({ length: 6 }).map((_, i) => (
          <SkelRow key={i} height={58} />
        ))}

        {!isLoading && visibleSessions.length === 0 && !error && (
          <EmptyState
            title={allSessions.length === 0 ? 'No chat sessions yet.' : 'No sessions match the current filter.'}
            description={
              allSessions.length === 0
                ? 'Start a chat to populate this view.'
                : 'Toggle “Show deleted” to include soft-deleted sessions.'
            }
            cta={allSessions.length === 0 ? { label: 'Go to Build', href: '#/build' } : undefined}
            testId="session-list-empty"
          />
        )}

        {visibleSessions.map((s: DebugSession) => (
          <SessionListRow
            key={s.id}
            session={s}
            active={s.id === selectedId}
            selected={selectedDeletedIds.has(s.id)}
            onSelect={onSelect}
            onToggleSelected={toggleSelected}
          />
        ))}
      </div>
    </div>
  );
}
