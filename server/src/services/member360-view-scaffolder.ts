/**
 * Member 360 view scaffolder.
 *
 * Generates a DRAFT `views/<game>/user_360.yml` for a game from the canonical
 * core-360 panel registry — the same source of truth the product reads — so an
 * operator looking at a `blocked`/`partial` coverage cell can produce a
 * ready-to-review starter view file instead of hand-writing one.
 *
 * Pure + no disk I/O: returns YAML text for the admin to review and place at
 * `cube-dev/cube/model/views/<game>/user_360.yml`. We deliberately do NOT write
 * to the mounted Cube model dir from a request — placing the file is a human,
 * git-tracked step (the draft may need base-cube/member edits per game first).
 *
 * Each view's `includes` are the bare base-cube fields the registry's panels
 * read (member `<view>.<field>` → include `<field>`), grouped by view. View →
 * base-cube join_path is the stable mapping used by the canonical cfm/ballistar
 * 360 views.
 */

import { dump } from 'js-yaml';

import {
  corePanelsForGame,
  type Member360Panel,
} from './member360-panel-registry.js';

/** view name → base cube (join_path), from the canonical cfm/ballistar views. */
const VIEW_BASE_CUBE: Record<string, string> = {
  user_profile: 'mf_users',
  user_activity_timeline: 'active_daily',
  user_recharge_timeline: 'user_recharge_daily',
  user_transactions: 'recharge',
  user_roles_panel: 'user_roles',
  user_devices_panel: 'user_devices',
  user_ips_panel: 'user_ips',
  user_activity_monthly: 'user_active_monthly',
  user_revenue_monthly: 'user_recharge_monthly',
};

export interface ScaffoldView {
  name: string;
  /** null when no canonical base-cube mapping exists (emit a TODO placeholder). */
  baseCube: string | null;
  includes: string[];
}

export interface Member360ScaffoldResult {
  game: string;
  views: ScaffoldView[];
  /** Views with no known base cube — the operator must set join_path manually. */
  unknownViews: string[];
  yaml: string;
}

const TODO_BASE_CUBE = 'TODO_set_base_cube';

/** Bare base-cube field for a `<view>.<field>` member (or null if shape is off). */
function bareField(member: string, view: string): string | null {
  const prefix = `${view}.`;
  return member.startsWith(prefix) ? member.slice(prefix.length) : null;
}

/** All bare fields the registry's panels read for one view, in encounter order. */
function includesForView(panels: Member360Panel[], view: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (member: string): void => {
    const f = bareField(member, view);
    if (f && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  };
  for (const p of panels) {
    if (p.view !== view) continue;
    for (const c of p.columns) add(c.member);
    for (const k of p.kpis ?? []) add(k.member);
    if (p.timeDimension) add(p.timeDimension);
  }
  return out;
}

export function scaffoldMember360View(gameId: string): Member360ScaffoldResult {
  const panels = corePanelsForGame(gameId);

  // Distinct views in panel order.
  const viewOrder: string[] = [];
  for (const p of panels) if (!viewOrder.includes(p.view)) viewOrder.push(p.view);

  const views: ScaffoldView[] = viewOrder.map((name) => ({
    name,
    baseCube: VIEW_BASE_CUBE[name] ?? null,
    includes: includesForView(panels, name),
  }));
  const unknownViews = views.filter((v) => !v.baseCube).map((v) => v.name);

  const body = {
    views: views.map((v) => ({
      name: v.name,
      description: `Single-entity 360 facet over ${v.baseCube ?? '<base cube>'} for ${gameId}. Filter by user_id equals for sub-second response.`,
      cubes: [{ join_path: v.baseCube ?? TODO_BASE_CUBE, includes: v.includes }],
    })),
  };

  const header = [
    `# DRAFT — Member 360 views for "${gameId}", scaffolded from the core-360 panel registry.`,
    `# Review against ${gameId}'s actual base cubes (members below must exist on each join_path),`,
    `# then place at cube-dev/cube/model/views/${gameId}/user_360.yml and restart the Cube container.`,
    unknownViews.length
      ? `# NOTE: set join_path for these views manually (no canonical base cube): ${unknownViews.join(', ')}.`
      : null,
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const yaml = header + dump(body, { lineWidth: 100, noRefs: true });
  return { game: gameId, views, unknownViews, yaml };
}
