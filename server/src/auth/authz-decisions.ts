/**
 * Pure authorization decisions shared by the request gates (workspace header,
 * game enforcement, feature gate). Keeps the "who may do what" logic in one
 * testable place; the middleware just plumbs `req.user` into these.
 *
 * Migration fallback: while per-user grants are still being seeded, a user with
 * NO grants in a dimension falls back to a permissive default (role-based for
 * workspaces, allow for games) when `AUTHZ_GRANT_FALLBACK` is on (default). Once
 * grants are populated the flag is flipped OFF (Phase 8) and the gates fail
 * closed. A user who DOES have grants is always checked against them, fallback
 * or not — so seeding a user immediately tightens their access.
 */

import {
  workspaceAllowsRole,
  type WorkspaceDef,
} from '../services/workspaces-config-loader.js';
import type { FeatureKey } from './feature-keys.js';
import { featureDefaultEnabled, isFeatureKey } from './feature-keys.js';

export interface AuthzSubject {
  role: 'viewer' | 'editor' | 'admin';
  workspaces: string[];
  allowedGames: string[];
  features: Record<string, boolean>;
}

export function grantFallbackEnabled(): boolean {
  const raw = (process.env.AUTHZ_GRANT_FALLBACK ?? 'true').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function userCanAccessWorkspace(
  subject: AuthzSubject,
  ws: Pick<WorkspaceDef, 'id' | 'allowedRoles'>,
): boolean {
  if (subject.workspaces.length > 0) return subject.workspaces.includes(ws.id);
  if (grantFallbackEnabled()) return workspaceAllowsRole(ws, subject.role);
  return false;
}

export function userCanAccessGame(subject: AuthzSubject, gameId: string): boolean {
  if (subject.allowedGames.length > 0) return subject.allowedGames.includes(gameId);
  if (grantFallbackEnabled()) return true; // migration ease — caller logs
  return false;
}

export function userHasFeature(subject: AuthzSubject, key: string): boolean {
  if (!isFeatureKey(key)) return false;
  const explicit = subject.features[key];
  if (typeof explicit === 'boolean') return explicit;
  return featureDefaultEnabled(key as FeatureKey);
}
