/**
 * Per-workspace Games grant: pick one of the user's granted workspaces, then
 * grant a subset of THAT workspace's available games. Game access is scoped per
 * workspace (a grant in one workspace doesn't carry to another); an empty
 * selection saved = fail-closed (no games) for that workspace.
 */

import React, { useEffect, useState } from 'react';
import {
  type AdminUser,
  type AdminRegistry,
  putAdminUserWorkspaceGames,
} from './use-admin-access';
import { GrantMatrix } from './grant-matrix';
import { useGrantSection } from './use-grant-section';

interface Props {
  user: AdminUser;
  registry: AdminRegistry | null;
  onSaved: (email: string) => void;
}

export function WorkspaceGamesSection({ user, registry, onSaved }: Props) {
  // Only offer workspaces the user is actually granted — granting games in an
  // ungranted workspace is dead data (the server fail-closes there anyway).
  const grantedWorkspaces = (registry?.workspaces ?? []).filter((w) =>
    user.workspaces.includes(w.id),
  );
  const [wsId, setWsId] = useState<string>(grantedWorkspaces[0]?.id ?? '');

  // Keep the selected workspace valid as the user's grants change (refetch /
  // switching the edited user).
  useEffect(() => {
    if (grantedWorkspaces.length === 0) {
      if (wsId) setWsId('');
      return;
    }
    if (!grantedWorkspaces.some((w) => w.id === wsId)) setWsId(grantedWorkspaces[0].id);
  }, [grantedWorkspaces, wsId]);

  if (grantedWorkspaces.length === 0) {
    return (
      <section style={panel}>
        <div style={heading}>Games per workspace</div>
        <div style={hint}>Grant a workspace first, then assign its games here.</div>
      </section>
    );
  }

  const gameNames = new Map((registry?.games ?? []).map((g) => [g.id, g.name]));
  const available = registry?.gamesByWorkspace?.[wsId] ?? [];
  const options = available.map((id) => ({ id, label: gameNames.get(id) ?? id }));

  return (
    <section style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={heading}>Games per workspace</div>
        <select value={wsId} onChange={(e) => setWsId(e.target.value)} style={select}>
          {grantedWorkspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
        </select>
      </div>
      {/* key={wsId} remounts the matrix on workspace switch so its selection
          resyncs to the newly-selected workspace's grant. */}
      <WorkspaceGamesMatrix
        key={wsId}
        email={user.email}
        wsId={wsId}
        granted={user.gamesByWorkspace[wsId] ?? []}
        options={options}
        onSaved={() => onSaved(user.email)}
      />
    </section>
  );
}

function WorkspaceGamesMatrix({
  email,
  wsId,
  granted,
  options,
  onSaved,
}: {
  email: string;
  wsId: string;
  granted: string[];
  options: Array<{ id: string; label: string }>;
  onSaved: () => void;
}) {
  const section = useGrantSection(
    granted,
    (ids) => putAdminUserWorkspaceGames(email, wsId, ids),
    onSaved,
  );
  return (
    <GrantMatrix
      title="Granted games"
      options={options}
      selected={section.selected}
      onToggle={section.toggle}
      onSave={section.save}
      saving={section.saving}
      saved={section.saved}
      error={section.error}
      onSelectAll={(ids) => section.selectAll(ids)}
      onClear={section.clear}
    />
  );
}

const panel: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
  padding: '14px 16px',
};

const heading: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text-primary)',
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginTop: 6,
};

const select: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)',
  background: 'var(--bg-app)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  minWidth: 160,
};
