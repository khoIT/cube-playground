/**
 * Pure mapping helpers for PerUserPanel.
 *
 * Extracted so they're unit-testable without full render and importable
 * by the panel component without circular deps.
 *
 * Feature grouping mirrors feature-keys.ts policy:
 *   - "Analyst surfaces" = everything except 'admin', default ON for active users.
 *   - "Admin / governance" = ['admin'], default OFF.
 *
 * An explicit per-user features[k] entry (regardless of value) constitutes an
 * "override" — it takes precedence over the group default and renders a badge.
 */

import type { AdminUser, AdminRegistry } from '../access/use-admin-access';

// ---------------------------------------------------------------------------
// switchability
// ---------------------------------------------------------------------------

export interface SwitchabilityResult {
  canSwitch: boolean;
  /** Human-readable note shown under the workspace grant matrix. */
  label: string;
}

/**
 * Derives workspace-switcher availability from the granted workspace ids.
 * >1 → switcher enabled; ==1 → pinned (hidden switcher); 0 → no cube data.
 */
export function switchability(workspaceIds: string[]): SwitchabilityResult {
  const n = workspaceIds.length;
  if (n > 1) {
    return {
      canSwitch: true,
      label: '✓ can switch — workspace switcher enabled',
    };
  }
  if (n === 1) {
    return {
      canSwitch: false,
      label: 'single — no switcher (user is pinned to this workspace)',
    };
  }
  return {
    canSwitch: false,
    label: "none granted — user can’t load cube data",
  };
}

// ---------------------------------------------------------------------------
// groupFeatures
// ---------------------------------------------------------------------------

export interface FeatureEntry {
  key: string;
  /** Resolved effective state: explicit override ?? group default for active users. */
  active: boolean;
  /** True when features[key] is explicitly set (regardless of value). */
  override: boolean;
}

export interface FeatureGroup {
  area: string;
  defaultOn: boolean;
  entries: FeatureEntry[];
}

/** Keys that belong to the Admin/governance group (default off). */
const GOVERNANCE_KEYS = new Set(['admin']);

/**
 * Groups feature keys from the registry into Analyst surfaces / Admin governance.
 * Resolves effective on/off per entry considering explicit user overrides.
 */
export function groupFeatures(
  registry: AdminRegistry,
  user: AdminUser,
): FeatureGroup[] {
  const analystKeys = registry.featureKeys.filter((k) => !GOVERNANCE_KEYS.has(k));
  const govKeys = registry.featureKeys.filter((k) => GOVERNANCE_KEYS.has(k));

  function toEntry(key: string, defaultOn: boolean): FeatureEntry {
    const explicit = user.features[key];
    const override = explicit !== undefined;
    // Explicit value wins; absent falls back to group default × active status.
    const active = override ? explicit : (defaultOn && user.status === 'active');
    return { key, active, override };
  }

  return [
    {
      area: 'Analyst surfaces',
      defaultOn: true,
      entries: analystKeys.map((k) => toEntry(k, true)),
    },
    {
      area: 'Admin / governance',
      defaultOn: false,
      entries: govKeys.map((k) => toEntry(k, false)),
    },
  ];
}

// ---------------------------------------------------------------------------
// Feature label map (display names)
// ---------------------------------------------------------------------------

export const FEATURE_LABEL: Record<string, string> = {
  chats: 'Chats',
  playground: 'Query playground',
  'data-model': 'Data model',
  'metrics-catalog': 'Metrics catalog',
  liveops: 'LiveOps',
  dashboards: 'Dashboards',
  segments: 'Segments',
  admin: 'Admin hub',
};

// ---------------------------------------------------------------------------
// relativeTime helper
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable relative-time string for a UTC ISO timestamp.
 * Uses Date.now() so tests can mock global Date if needed.
 */
export function relativeTime(isoOrNull: string | null): string {
  if (!isoOrNull) return 'never';
  const diffMs = Date.now() - Date.parse(isoOrNull);
  const days = Math.round(diffMs / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

// ---------------------------------------------------------------------------
// QueryShape summary
// ---------------------------------------------------------------------------

export interface QueryShape {
  cubes: string[];
  measures: string[];
  dimensions: string[];
}

/** "mf_users · 2 measure(s) · 1 dim(s)" */
export function formatQueryShape(shape: QueryShape): string {
  return `${shape.cubes.join(', ')} · ${shape.measures.length} measure(s) · ${shape.dimensions.length} dim(s)`;
}

/** The selected members, comma-joined — the actual "what" of the query.
 *  Falls back to the cube name(s), then a generic label. */
export function summarizeShapeMembers(shape: QueryShape): string {
  const members = [...shape.measures, ...shape.dimensions];
  if (members.length > 0) return members.join(', ');
  return shape.cubes.length > 0 ? shape.cubes.join(', ') : 'query';
}

/**
 * Builds an in-app Query-playground deep-link that re-opens a recorded shape.
 * Only member NAMES travel (measures + dimensions) — the same privacy-safe
 * surface that was persisted; no filter values or date ranges exist to leak.
 * Returns null when the shape carries nothing selectable.
 *
 * URL form `/build?query=<URLencoded-JSON>` — QueryBuilderContainer reads
 * `params.get('query')` and JSON.parses it.
 */
export function buildShapePlaygroundUrl(shape: QueryShape): string | null {
  const query: { measures?: string[]; dimensions?: string[] } = {};
  if (shape.measures.length > 0) query.measures = shape.measures;
  if (shape.dimensions.length > 0) query.dimensions = shape.dimensions;
  if (!query.measures && !query.dimensions) return null;
  return `/build?query=${encodeURIComponent(JSON.stringify(query))}`;
}
