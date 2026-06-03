/**
 * Users & Access tab — master-detail layout.
 *
 * LEFT:  PreProvisionForm (add new user) + UserList (search, pending filter, selection)
 * RIGHT: PerUserPanel for the selected user, or an empty-state placeholder.
 *
 * On any mutation (role/status save, grant save, new user created) the hook
 * refetches the full user list then re-derives the selected user from it.
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  useAdminUsers,
  useAdminRegistry,
  fetchAdminUser,
} from '../access/use-admin-access';
import { UserList } from '../access/user-list';
import { PreProvisionForm } from '../access/pre-provision-form';
import { PerUserPanel } from './per-user-panel';

export function UsersAndAccessTab() {
  const { users, loading, error, refetch } = useAdminUsers();
  const { registry } = useAdminRegistry();
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => users.find((u) => u.email === selectedEmail) ?? null,
    [users, selectedEmail],
  );

  // After any mutation: refetch list so grants/role/status stay fresh.
  // We also call fetchAdminUser to ensure the selected row is up-to-date
  // even before the full list finishes loading (optimistic UX).
  const handleSaved = useCallback(
    async (email: string) => {
      refetch();
      // fetchAdminUser is fire-and-forget for the individual row — the list
      // refetch above is the source of truth for the selectedUser derivation.
      await fetchAdminUser(email).catch(() => undefined);
      setSelectedEmail(email);
    },
    [refetch],
  );

  const handleCreated = useCallback(
    (email: string) => {
      refetch();
      setSelectedEmail(email);
    },
    [refetch],
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 320px) 1fr',
        gap: 16,
        alignItems: 'start',
        marginTop: 16,
      }}
    >
      {/* Left column: provision form + user list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PreProvisionForm onCreated={handleCreated} />
        <UserList
          users={users}
          loading={loading}
          error={error}
          selectedEmail={selectedEmail}
          onSelect={setSelectedEmail}
        />
      </div>

      {/* Right column: per-user panel or empty state */}
      {selectedUser && registry ? (
        <PerUserPanel
          user={selectedUser}
          registry={registry}
          onSaved={handleSaved}
        />
      ) : (
        <div
          style={{
            border: '1px dashed var(--border-card)',
            borderRadius: 'var(--radius-lg)',
            padding: 48,
            textAlign: 'center',
            fontSize: 14,
            color: 'var(--text-muted)',
            background: 'var(--bg-card)',
          }}
        >
          {loading
            ? 'Loading users…'
            : 'Select a user to manage their role, access, and feature grants.'}
        </div>
      )}
    </div>
  );
}
