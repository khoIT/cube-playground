/**
 * Contact-fatigue governance: stop a VIP matching many playbooks from being
 * spammed. Before surfacing a proactive "take care" action we check the VIP's
 * recent proactive outreaches (treated cases, across ALL playbooks) against the
 * game's window cap + per-channel cooldown.
 *
 * Verdicts:
 *   - allow          — under cap and channel off cooldown.
 *   - defer          — cap/cooldown hit; non-urgent priority → queue row deferred.
 *   - blocked_override — cap/cooldown hit AND priority 'cao' → a HUMAN decides
 *                        (never silently suppress an urgent case).
 *
 * Pure `evaluateFatigue` for unit-testing; `checkFatigue` wires it to the ledger.
 */

import { listCases } from './care-case-store.js';
import { getGovernance, type CareChannel, type GovernanceConfig } from './care-governance-store.js';
import type { PlaybookPriority } from './playbook-registry.js';

export type FatigueVerdict = 'allow' | 'defer' | 'blocked_override';

export interface PriorOutreach {
  treatedAt: string; // ISO
  channel: CareChannel | string | null;
}

export interface FatigueInput {
  recent: PriorOutreach[];
  governance: GovernanceConfig;
  channel: CareChannel;
  priority: PlaybookPriority;
  now: Date;
}

export interface FatigueResult {
  verdict: FatigueVerdict;
  reason: string;
  /** Earliest time the contact would be allowed (ISO), when deferred/blocked. */
  nextEligibleAt?: string;
}

const HOUR_MS = 3_600_000;

export function evaluateFatigue(input: FatigueInput): FatigueResult {
  const { recent, governance, channel, priority, now } = input;
  const nowMs = now.getTime();

  // Window cap — count ALL proactive outreaches inside the window.
  const windowMs = governance.windowHours * HOUR_MS;
  const inWindow = recent.filter((r) => {
    const t = Date.parse(r.treatedAt);
    return Number.isFinite(t) && nowMs - t < windowMs;
  });
  const capHit = inWindow.length >= governance.maxContactsPerWindow;

  // Per-channel cooldown — most recent outreach on THIS channel.
  const cooldownHours = governance.perChannelCooldownHours[channel] ?? 0;
  const cooldownMs = cooldownHours * HOUR_MS;
  const lastOnChannel = recent
    .filter((r) => r.channel === channel)
    .map((r) => Date.parse(r.treatedAt))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  const cooldownActive = lastOnChannel != null && nowMs - lastOnChannel < cooldownMs;

  if (!capHit && !cooldownActive) {
    return { verdict: 'allow', reason: 'under cap and channel off cooldown' };
  }

  // Compute the earliest time both constraints clear. The cap clears when the
  // in-window count drops BELOW the cap — i.e. when the N-th-newest contact ages
  // out (windowMs after it), not when the oldest does. (Identical to the oldest
  // only when the cap is 1.)
  const inWindowDesc = inWindow
    .map((r) => Date.parse(r.treatedAt))
    .sort((a, b) => b - a);
  const capClearAt = capHit
    ? (inWindowDesc[governance.maxContactsPerWindow - 1] ?? nowMs) + windowMs
    : nowMs;
  const cooldownClearAt = cooldownActive && lastOnChannel != null ? lastOnChannel + cooldownMs : nowMs;
  const nextEligibleAt = new Date(Math.max(capClearAt, cooldownClearAt)).toISOString();

  const reasonParts: string[] = [];
  if (capHit) reasonParts.push(`${inWindow.length}/${governance.maxContactsPerWindow} contacts in ${governance.windowHours}h`);
  if (cooldownActive) reasonParts.push(`${channel} cooldown ${cooldownHours}h active`);
  const reason = reasonParts.join('; ');

  // Urgent cases over cap are never silently suppressed — a human decides.
  if (priority === 'cao') {
    return { verdict: 'blocked_override', reason: `${reason} — override?`, nextEligibleAt };
  }
  return { verdict: 'defer', reason, nextEligibleAt };
}

/**
 * Ledger-backed fatigue check for a VIP about to be contacted on `channel`.
 * Uses every treated case for the uid (across playbooks) as the outreach history.
 */
export function checkFatigue(
  gameId: string,
  uid: string,
  channel: CareChannel,
  priority: PlaybookPriority,
  now: Date = new Date(),
): FatigueResult {
  const treated = listCases({ gameId, uid, status: 'treated' });
  const recent: PriorOutreach[] = treated
    .filter((c) => c.treated_at)
    .map((c) => ({ treatedAt: c.treated_at as string, channel: c.channel_used }));
  return evaluateFatigue({ recent, governance: getGovernance(gameId), channel, priority, now });
}
