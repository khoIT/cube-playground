/**
 * Data hooks for the Admin Access page over /api/admin/*.
 * All requests go through apiFetch (auto Bearer + workspace header).
 * Server enforces admin role + feature; the UI guard is convenience.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

export type AdminRole = 'viewer' | 'editor' | 'admin';
export type AdminStatus = 'pending' | 'active' | 'disabled';

export interface AdminUser {
  email: string;
  role: AdminRole;
  status: AdminStatus;
  kcSub: string | null;
  workspaces: string[];
  /** Game grants scoped per workspace id. */
  gamesByWorkspace: Record<string, string[]>;
  features: Record<string, boolean>;
  lastLogin: string | null;
}

export interface AdminRegistry {
  workspaces: Array<{ id: string; label: string }>;
  games: Array<{ id: string; name: string }>;
  /** Games each workspace can expose (prefix workspaces surface only their
   *  gamePrefixMap keys). Drives the per-workspace grant matrix options. */
  gamesByWorkspace: Record<string, string[]>;
  featureKeys: string[];
}

function encodeEmail(email: string): string {
  return encodeURIComponent(email);
}

// ── List ─────────────────────────────────────────────────────────────────────

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ users: AdminUser[] }>('/api/admin/users')
      .then((data) => setUsers(data.users ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { users, loading, error, refetch };
}

// ── Registry ───────────────────────────────────────────────────────────────

export function useAdminRegistry() {
  const [registry, setRegistry] = useState<AdminRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AdminRegistry>('/api/admin/registry')
      .then(setRegistry)
      .catch((err: Error) => setError(err.message));
  }, []);

  return { registry, error };
}

// ── Single-user refetch (post-mutation) ──────────────────────────────────────

export async function fetchAdminUser(email: string): Promise<AdminUser | null> {
  const data = await apiFetch<{ users: AdminUser[] }>('/api/admin/users');
  return data.users.find((u) => u.email === email) ?? null;
}

// ── Mutators ─────────────────────────────────────────────────────────────────

export interface CreateUserBody {
  email: string;
  role?: AdminRole;
  status?: AdminStatus;
  workspaceIds?: string[];
  gamesByWorkspace?: Record<string, string[]>;
  features?: Record<string, boolean>;
}

export function createAdminUser(body: CreateUserBody): Promise<void> {
  return apiFetch('/api/admin/users', { method: 'POST', body });
}

export function patchAdminUser(
  email: string,
  body: { role?: AdminRole; status?: AdminStatus },
): Promise<void> {
  return apiFetch(`/api/admin/users/${encodeEmail(email)}`, { method: 'PATCH', body });
}

export function putAdminUserWorkspaces(email: string, workspaceIds: string[]): Promise<void> {
  return apiFetch(`/api/admin/users/${encodeEmail(email)}/workspaces`, {
    method: 'PUT',
    body: { workspaceIds },
  });
}

export function putAdminUserWorkspaceGames(
  email: string,
  workspaceId: string,
  gameIds: string[],
): Promise<void> {
  return apiFetch(
    `/api/admin/users/${encodeEmail(email)}/workspaces/${encodeURIComponent(workspaceId)}/games`,
    { method: 'PUT', body: { gameIds } },
  );
}

export function putAdminUserFeatures(
  email: string,
  features: Record<string, boolean>,
): Promise<void> {
  return apiFetch(`/api/admin/users/${encodeEmail(email)}/features`, {
    method: 'PUT',
    body: { features },
  });
}
