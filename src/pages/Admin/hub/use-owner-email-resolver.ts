/**
 * useOwnerEmailResolver — resolves a chat-session owner_id (Keycloak sub) to
 * the owner's email for the admin chat-audit Sessions tab.
 *
 * Session owners are keyed by Keycloak `sub` (UUID); their ad-hoc `label` is
 * usually null. The admin users list carries `{ email, kcSub }`, so a
 * sub→email map lets the owner filter read as real emails instead of UUIDs.
 *
 * Admin-context only: built from `useAdminUsers()` (admin-gated). The returned
 * resolver falls back to `label ?? ownerId` for synthetic/verifier owners and
 * any sub with no matching admin-user row, so it never renders an empty string.
 */

import { useMemo } from 'react';
import { useAdminUsers } from '../access/use-admin-access';

export type OwnerRef = { ownerId: string; label: string | null };
export type ResolveOwner = (o: OwnerRef) => string;

export function useOwnerEmailResolver(): ResolveOwner {
  const { users } = useAdminUsers();

  return useMemo<ResolveOwner>(() => {
    const emailBySub = new Map<string, string>();
    for (const u of users) {
      if (u.kcSub) emailBySub.set(u.kcSub, u.email);
    }
    return (o: OwnerRef) => emailBySub.get(o.ownerId) ?? o.label ?? o.ownerId;
  }, [users]);
}
