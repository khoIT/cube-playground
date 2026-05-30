/**
 * /admin/access — admin-only master-detail page to manage who can access what.
 * Left: searchable user list (+ pending filter + pre-provision form).
 * Right: role/status editor + workspace/game/feature grant matrices.
 * Mirrors the Dashboards page-header pattern (icon + 20/700 title, 24px/32px pad).
 */

import React, { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAdminUsers, useAdminRegistry } from './use-admin-access';
import { UserList } from './user-list';
import { AccessEditor } from './access-editor';
import { PreProvisionForm } from './pre-provision-form';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

export function AdminAccessPage() {
  const { users, loading, error, refetch } = useAdminUsers();
  const { registry } = useAdminRegistry();
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => users.find((u) => u.email === selectedEmail) ?? null,
    [users, selectedEmail],
  );

  function handleSaved(email: string) {
    refetch();
    setSelectedEmail(email);
  }

  function handleCreated(email: string) {
    refetch();
    setSelectedEmail(email);
  }

  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        Administration
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ShieldCheck size={20} style={{ color: 'var(--brand)' }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Access</h1>
      </div>
      <p style={{ margin: '4px 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>
        Manage who can sign in and what workspaces, games, and features they can reach.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PreProvisionForm onCreated={handleCreated} />
          <UserList
            users={users}
            loading={loading}
            error={error}
            selectedEmail={selectedEmail}
            onSelect={setSelectedEmail}
          />
        </div>

        {selectedUser ? (
          <AccessEditor user={selectedUser} registry={registry} onSaved={handleSaved} />
        ) : (
          <div
            style={{
              border: '1px dashed var(--border-card)', borderRadius: 'var(--radius-lg)',
              padding: 48, textAlign: 'center', fontSize: 14, color: 'var(--text-muted)',
              background: 'var(--bg-card)',
            }}
          >
            Select a user to edit their role, status, and grants.
          </div>
        )}
      </div>
    </div>
  );
}
